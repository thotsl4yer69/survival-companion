"""Optional browser-level smoke test. Requires Playwright and local Chromium."""
from __future__ import annotations
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]


def unused_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); return s.getsockname()[1]


def main():
    with tempfile.TemporaryDirectory() as td:
        port=unused_port()
        env=dict(os.environ,BLACKBOX_DB=str(Path(td)/'test.sqlite3'),BLACKBOX_HOST='127.0.0.1',
                 BLACKBOX_PORT=str(port),BLACKBOX_TOKEN='browser-e2e-token-long-123456789',BLACKBOX_NODE_KEY='e2e-node-key')
        process=subprocess.Popen([sys.executable,str(ROOT/'app.py')],env=env,cwd=ROOT,
                                 stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            for attempt in range(40):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=.5) as res:
                        assert res.status==200
                    break
                except Exception:time.sleep(.1)
            else:raise RuntimeError('Server did not start')
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1440,'height':900})
                errors=[]
                page.on('pageerror',lambda err:errors.append(str(err)))
                page.goto(f'http://127.0.0.1:{port}',wait_until='networkidle')
                assert page.locator('#auth-gate').is_visible()
                page.fill('#token-field','browser-e2e-token-long-123456789')
                page.click('#auth-form button')
                page.wait_for_function("document.querySelector('#m-service').textContent === 'ONLINE'")
                assert not page.locator('#auth-gate').is_visible()
                page.click('[data-tab="supplies"]')
                page.fill('#supply-form input[name="name"]','QA actual value')
                page.fill('#supply-form input[name="quantity"]','2')
                page.click('#supply-form button[type="submit"]')
                page.get_by_text('QA actual value',exact=True).wait_for()
                page.click('[data-tab="knowledge"]')
                page.fill('#knowledge-form input[name="question"]','water')
                page.click('#knowledge-form button')
                page.get_by_text('Drinking-water safety and storage',exact=True).first.wait_for()
                page.click('[data-tab="system"]')
                page.click('#lock-btn')
                assert page.locator('#auth-gate').is_visible()
                assert page.evaluate("sessionStorage.getItem('blackbox_access_token')") is None
                page.fill('#token-field','browser-e2e-token-long-123456789')
                page.click('#auth-form button')
                page.click('[data-tab="overview"]')
                page.screenshot(path=str(ROOT/'dashboard_preview.png'),full_page=True)
                phone=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
                phone.goto(f'http://127.0.0.1:{port}',wait_until='networkidle')
                phone.fill('#token-field','browser-e2e-token-long-123456789')
                phone.click('#auth-form button')
                phone.wait_for_function("document.querySelector('#m-service').textContent === 'ONLINE'")
                phone.screenshot(path=str(ROOT/'dashboard_mobile_preview.png'),full_page=True)
                assert not errors, errors
                print('Browser smoke PASS: authentication, inventory, knowledge, lock, desktop/mobile, no JS errors')
                browser.close()
        finally:
            process.terminate()
            try:process.communicate(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.communicate()

if __name__=='__main__':main()
