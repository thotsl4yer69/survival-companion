/* BLACKBOX/GHOSTLINK adjustable electronics field-node case
   Unit: mm. Generically sized; fit against your actual PCB, ports,
   connectors and antenna before printing. Not waterproof, EMI-shielded or EMP-rated.
   Print lid with flat outer roof surface down.
   Set PART to "base", "lid", or "layout" before exporting STL.
*/
$fn = 60;
PART = "layout";
inner_x = 98;  // intended free interior width
inner_y = 62;  // intended free interior depth
height = 33;   // total base height
wall = 2.4;
floor_thickness = 2.8;
lid_wall = 2.1;
lid_roof = 2.8;
lid_skirt = 8;
fit_clearance = 0.30; // each side; adjust after real calibration test
corner = 3.0;
antenna_hole_d = 7.2; // optional bulkhead hole; validate component before use
cable_opening_w = 16;
cable_opening_z = 11;

outer_x = inner_x + 2*wall;
outer_y = inner_y + 2*wall;

module rounded_rect(x,y,r){
  offset(r=r) square([x-2*r,y-2*r],center=true);
}
module slot3d(len,w,z){
  linear_extrude(height=z) hull(){
    translate([-(len-w)/2,0]) circle(d=w,$fn=24);
    translate([(len-w)/2,0]) circle(d=w,$fn=24);
  }
}
module base(){
 difference(){
   linear_extrude(height=height) rounded_rect(outer_x,outer_y,corner);
   translate([0,0,floor_thickness]) linear_extrude(height=height+1)
     rounded_rect(inner_x,inner_y,max(0.6,corner-wall));
   // Two rows of tie-down slots through the floor. Deliberately open to air.
   for (xx=[-25,25], yy=[-16,16])
     translate([xx,yy,-0.1]) slot3d(15,3.5,floor_thickness+0.3);
   // Generic cable access: on the short side, deliberately above the floor.
   translate([0,-outer_y/2,12]) cube([cable_opening_w,wall*4,cable_opening_z],center=true);
   // Antenna bulkhead hole on right wall.
   translate([outer_x/2,0,20]) rotate([0,90,0]) cylinder(d=antenna_hole_d,h=wall*4,center=true);
 }
 // Lightweight floor rails to separate electronics from the outer shell base.
 for (xx=[-14,14])
   translate([xx,0,floor_thickness+1]) cube([3.5,inner_y-20,2],center=true);
}
module lid(){
 lid_in_x=outer_x+2*fit_clearance;
 lid_in_y=outer_y+2*fit_clearance;
 lid_out_x=lid_in_x+2*lid_wall;
 lid_out_y=lid_in_y+2*lid_wall;
 difference(){
   union(){
     linear_extrude(height=lid_roof) rounded_rect(lid_out_x,lid_out_y,corner+lid_wall);
     translate([0,0,lid_roof]) linear_extrude(height=lid_skirt)
       difference(){
         rounded_rect(lid_out_x,lid_out_y,corner+lid_wall);
         rounded_rect(lid_in_x,lid_in_y,corner+fit_clearance);
       }
   }
   // No unverified screw posts. Slip fit measured in physical prototype.
 }
}
if(PART=="base") base();
else if(PART=="lid") lid();
else {
  translate([-65,0,0]) base();
  translate([65,0,0]) lid();
}
