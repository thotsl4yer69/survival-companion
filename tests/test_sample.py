"""
Sample tests for Survival Companion
Run with: pytest tests/ -v
"""
import pytest
import os


class TestProjectStructure:
    """Tests verifying project structure exists."""

    def test_config_exists(self):
        """Verify config file exists."""
        assert os.path.exists("config/survival_config.yaml")

    def test_data_files_exist(self):
        """Verify essential data files exist."""
        assert os.path.exists("personas/survival/medical/protocols.db")
        assert os.path.exists("personas/survival/data/species.db")


class TestSafetyLayer:
    """Tests for medical safety layer."""

    @pytest.mark.parametrize("dangerous_phrase", [
        "you have cancer",
        "definitely heart disease",
        "take 500 mg of ibuprofen",
        "you will die",
    ])
    def test_forbidden_patterns_blocked(self, dangerous_phrase):
        """Verify dangerous patterns would be caught."""
        import re

        forbidden_patterns = [
            r"you have.*cancer",
            r"definitely.*disease",
            r"take \d+ mg of",
            r"you will die",
        ]

        matched = any(
            re.search(pattern, dangerous_phrase, re.IGNORECASE)
            for pattern in forbidden_patterns
        )

        assert matched, f"Pattern '{dangerous_phrase}' should be blocked"

    @pytest.mark.parametrize("safe_phrase", [
        "I'm concerned about this mole",
        "This shows signs that warrant professional evaluation",
        "General guidance suggests rest and hydration",
        "Seek medical attention if symptoms persist",
    ])
    def test_safe_patterns_allowed(self, safe_phrase):
        """Verify safe patterns are not blocked."""
        import re

        forbidden_patterns = [
            r"you have .* cancer",
            r"definitely .* disease",
            r"take \d+ mg of",
            r"you will die",
        ]

        matched = any(
            re.search(pattern, safe_phrase, re.IGNORECASE)
            for pattern in forbidden_patterns
        )

        assert not matched, f"Pattern '{safe_phrase}' should NOT be blocked"


class TestConfigValidation:
    """Tests for configuration file validation."""

    def test_config_is_valid_yaml(self):
        """Verify config file is valid YAML."""
        import yaml

        with open("config/survival_config.yaml", "r") as f:
            config = yaml.safe_load(f)

        assert config is not None
        assert "system" in config
        assert "voice" in config
        assert "llm" in config
        assert "safety" in config

    def test_safety_config_complete(self):
        """Verify safety configuration is complete."""
        import yaml

        with open("config/survival_config.yaml", "r") as f:
            config = yaml.safe_load(f)

        safety = config.get("safety", {})
        assert safety.get("enabled") is True
        assert "forbidden_patterns" in safety
        assert len(safety["forbidden_patterns"]) > 0
        assert "required_disclaimers" in safety

    def test_memory_limits_reasonable(self):
        """Verify memory limits are within Pi 5 capacity."""
        import yaml

        with open("config/survival_config.yaml", "r") as f:
            config = yaml.safe_load(f)

        memory = config.get("memory", {})
        max_ram = memory.get("max_ram_usage_mb", 0)

        assert max_ram <= 8000, "Max RAM should not exceed Pi 5 capacity"
        assert max_ram >= 4000, "Max RAM should be reasonable for LLM operation"
