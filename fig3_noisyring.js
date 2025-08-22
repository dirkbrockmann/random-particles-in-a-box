window.noisy_ring = function(id,dw,dh,cw,ch){

var displayw = dw || 500;
var displayh = dh || 500;
var controlh = ch || 300;
var controlw = cw || 500;

var margin = {l:0,r:0,t:0,b:0};

	var g = widget.grid(controlw,controlh,12,12);
	var anchors = g.lattice(); // g has a method that returns a lattice with x,y coordinates

	var display = d3.select("#"+id+"-display")
		.append("svg").attr("width","100%")
		.attr("height","100%")
		.attr("viewBox", "0 0 "+displayw+" "+displayh)
	
	var controls = d3.select("#"+id+"-controls")
		.append("svg").attr("width","100%")
		.attr("height","100%")
		.attr("viewBox", "0 0 "+controlw+" "+controlh)
	
/*	controls.selectAll(".grid").data(anchors).enter().append("circle")
		.attr("class","grid")
		.attr("transform",function(d){return "translate("+d.x+","+d.y+")"})
		.attr("r",1)
		.style("fill","black")
		.style("stroke","none")*/
	var t;
	var N = 200, dt = 0.01;
	
	var def_sigma= 0.025, 
		def_K = 2;
			
	var xr=[-2,2],yr=[-2,2];
	
	var buttonblock = g.block({x0:4,y0:10,width:4,height:0}).Nx(2);
	var sliderblock = g.block({x0:1,y0:1,width:10,height:4}).Ny(2);
	
	var playpause = { id:id+"b1", name:"", actions: ["play","pause"], value: 0};
	var reset = { id:id+"b3", name:"", actions: ["rewind"], value: 0};
	
	var buttons = [
		widget.button(playpause).update(runpause),
		widget.button(reset).update(resetthing)
	]
	
	var sigma = {id:id+"noise", name: "noise", range: [0,0.1], value: def_sigma};
	var K = {id:id+"force", name: "force", range: [0,3], value: def_K};

	var sliderwidth = sliderblock.w();
	var handleSize = 12, trackSize = 8;

	var slider = [
		widget.slider(sigma).width(sliderwidth).trackSize(trackSize).handleSize(handleSize),
		widget.slider(K).width(sliderwidth).trackSize(trackSize).handleSize(handleSize)
	]
	
	var X = d3.scaleLinear().domain(xr).range([margin.l, displayw-margin.r]),
		Y = d3.scaleLinear().domain(yr).range([displayh-margin.b,0+margin.t]);

	var color = d3.interpolateRdGy;
			
	var dw = d3.randomNormal(0,1);
	
	var tick = 0;
	var agents = d3.range(N).map(function(d,i){
		return {
			id:i,
			hue:Math.random(),
			x:1,
			y:1,
			trajectory: [{x:1,y:1}] 
		}
	})
	

		
	display.selectAll(".agent").data(agents).enter().append("circle")
		.attr("class","agent")
		.attr("r","4")
		.style("fill",function(d){return color(d.hue)})
		.style("stroke","gray")
		.style("stroke",".5px")
		.attr("transform",function(d){return "translate("+X(d.x)+","+Y(d.y)+")"})

	function runpause(d){ d.value == 1 ? t = d3.timer(runsim,0) : t.stop(); }
		
	function runsim (){
		tick+=1;
		agents.forEach(function(d){
			
			r = Math.sqrt(d.x*d.x+d.y*d.y);
			var x_new= d.x + dt * K.value*d.x*r*(1-r)+Math.sqrt(sigma.value*dt)*dw();
			var y_new= d.y + dt * K.value*d.y*r*(1-r)+Math.sqrt(sigma.value*dt)*dw();

			d.x= x_new;
			d.y= y_new;

			d.trajectory.push({x:d.x,y:d.y});
		})
		
		
		display.selectAll(".agent").data(agents).attr("transform",function(d){return "translate("+X(d.x)+","+Y(d.y)+")"})
		
	
	}
	

	
	function resetthing(){
		agents = d3.range(N).map(function(d,i){
				return {
					id:i,
					hue:Math.random(),
					x:1,
					y:1,
					trajectory: [{x:1,y:1}] 
				}
			})
		
		display.selectAll(".agent").data(agents).attr("transform",function(d){return "translate("+X(d.x)+","+Y(d.y)+")"})
				
	}

	
	var bu = controls.selectAll(".button").data(buttons).enter().append(widget.buttonElement)
		.attr("transform",function(d,i){return "translate("+buttonblock.x(i)+","+buttonblock.y(0)+")"});		

	var sl = controls.selectAll(".slider").data(slider).enter().append(widget.sliderElement)
		.attr("transform",function(d,i){return "translate("+sliderblock.x(0)+","+sliderblock.y(i)+")"});
	
		
	}
	