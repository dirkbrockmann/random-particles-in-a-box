window.random_motion = function(id,dw,dh,cw,ch){

var displayw = dw || 500;
var displayh = dh || 500;
var controlh = ch || 200;
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
	
	var N = 20, Tmax = 1000, L=2; Tail=100;
	var def_speed= 0.01, def_noise = 0.3;
			
	var xr=[0,L],yr=[0,L];
	
	var buttonblock = g.block({x0:4,y0:10,width:4,height:0}).Nx(2);
	var sliderblock = g.block({x0:1,y0:1,width:10,height:4}).Ny(2);
	
	var playpause = { id:id+"b1", name:"", actions: ["play","pause"], value: 0};
	var reset = { id:id+"b3", name:"", actions: ["rewind"], value: 0};
	
	var buttons = [
		widget.button(playpause).update(runpause),
		widget.button(reset).update(resetthing)
	]
	
	var speed = {id:id+"speed", name: "speed", range: [0.001,0.02], value: def_speed};
	var noise = {id:id+"noise", name: "noise", range: [0,1], value: def_noise};

	var sliderwidth = sliderblock.w();
	var handleSize = 12, trackSize = 8;

	var slider = [
		widget.slider(speed).width(sliderwidth).trackSize(trackSize).handleSize(handleSize),
		widget.slider(noise).width(sliderwidth).trackSize(trackSize).handleSize(handleSize)
	]
	
	var X = d3.scaleLinear().domain(xr).range([margin.l, displayw-margin.r]),
		Y = d3.scaleLinear().domain(yr).range([displayh-margin.b,0+margin.t]);

	var color = d3.interpolateRdGy;
		
	var curve = d3.line().x(function(d) { return X(d.x); }).y(function(d) { return Y(d.y); });
	
	var dw = d3.randomNormal(0,1);
	
	var tick = 0;
	var agents = d3.range(N).map(function(d,i){
		return {
			id:i,
			hue:Math.random(),
			x:L/2,
			y:L/2,
			theta:Math.random()*2*Math.PI,
			trajectory: [{x:L/2,y:L/2}] 
		}
	})
	
	display.selectAll(".trace").data(agents).enter().append("path")
		.attr("class","trace")
		.attr("d",function(d){return curve(d.trajectory)})
		.style("fill","none")
		.style("stroke",function(d){return color(d.hue)})
		.style("stroke-width","2px")
//		.style("opacity",0.5)
		
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
			d.theta=d.theta+noise.value*dw();
			dx=speed.value*Math.cos(d.theta);
			dy=speed.value*Math.sin(d.theta);
			
			var x_new= (d.x + dx);
			var y_new= (d.y + dy);
		
			if (x_new < 0 || x_new > L) dx *= -1;
			if (y_new < 0 || y_new > L) dy *= -1;

			d.x= (d.x + dx)
			d.y= (d.y + dy)
			d.theta = Math.atan2(dy,dx)
			
			d.trajectory.push({x:d.x,y:d.y});
			if(tick>Tail) d.trajectory.shift();
		})
		
		display.selectAll(".trace").data(agents).attr("d",function(d){return curve(d.trajectory)})
		
		display.selectAll(".agent").data(agents).attr("transform",function(d){return "translate("+X(d.x)+","+Y(d.y)+")"})
		
	
	}
	

	
	function resetthing(){
		tick=0;
		agents = d3.range(N).map(function(d,i){
				return {
					id:i,
					hue:Math.random(),
					x:L/2,
					y:L/2,
					theta:Math.random()*2*Math.PI,
					trajectory: [{x:L/2,y:L/2}] 
				}
			})
		display.selectAll(".trace").data(agents).attr("d",function(d){return curve(d.trajectory)})
		
		display.selectAll(".agent").data(agents).attr("transform",function(d){return "translate("+X(d.x)+","+Y(d.y)+")"})
				
	}

	
	var bu = controls.selectAll(".button").data(buttons).enter().append(widget.buttonElement)
		.attr("transform",function(d,i){return "translate("+buttonblock.x(i)+","+buttonblock.y(0)+")"});		

	var sl = controls.selectAll(".slider").data(slider).enter().append(widget.sliderElement)
		.attr("transform",function(d,i){return "translate("+sliderblock.x(0)+","+sliderblock.y(i)+")"});
	
		
	}
	