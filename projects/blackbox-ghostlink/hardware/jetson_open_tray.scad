/* BLACKBOX open Jetson Orin Nano Super dev kit tray.
   Uses published external envelope 103 x 90.5 mm as a starting point.
   NOT aligned to specific PCB mounting-hole pattern. An open strap-retention
   and rubber-feet support tray; confirm air intake, connectors and clearances
   against the actual dev kit before installing or energising.
   No sealed lid: Jetson cooling is required. Units mm.
*/
$fn=48;
module pill(length,width){hull(){translate([-(length-width)/2,0])circle(d=width);translate([(length-width)/2,0])circle(d=width);}}
inner_x=113;
inner_y=102;
wall=3.4;
floor=3.2;
rim_height=14;
outer_x=inner_x+2*wall;
outer_y=inner_y+2*wall;

module tray(){
 difference(){
   union(){
     translate([-outer_x/2,-outer_y/2,0])cube([outer_x,outer_y,rim_height]);
     // Four small feet elevate the frame off a work surface.
     for(x=[-outer_x/2+10,outer_x/2-10],y=[-outer_y/2+10,outer_y/2-10])
        translate([x,y,-3])cylinder(d=13,h=3);
   }
   translate([-inner_x/2,-inner_y/2,floor])cube([inner_x,inner_y,rim_height+1]);
   // Bottom ventilation slots; do not obstruct underside airflow.
   for(y=[-32,-20,-8,4,16,28])
     translate([0,y,-0.2])linear_extrude(height=floor+0.4)pill(76,6);
   // Two cable access openings at each short side.
   for(y=[-outer_y/2,outer_y/2],x=[-28,28])
     translate([x,y,10])cube([20,wall*3,9],center=true);
   // Tie-down holes on outer floor edge. Avoid thermal hardware and ports.
   for(y=[-38,38],x=[-48,48])
     translate([x,y,-0.2])linear_extrude(height=floor+0.4)pill(10,4);
 }
 // Raised supports: positioned inside footprint, use foam pad / actual fit.
 for(x=[-37,37],y=[-30,30])
   translate([x,y,floor])cylinder(d=9,h=2.7);
}
tray();
