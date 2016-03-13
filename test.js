'use strict';

const Promise = require("bluebird");
const taskQueue = require("./");

let queue = taskQueue();

queue.define("build", function(data) {
	return Promise.try(() => {
		console.log("Building with data:", data);
		return Promise.delay((Math.random() * 500) + 100)
	}).then(function() {
		if (Math.random() < 0.25) {
			throw new Error("Dummy failure!");
		} else {
			return `Success! ${data.id}`;
		}
	});
}, {
	concurrency: 2,
	interval: 2
});

queue.on("started:build", function(task) {
	console.log(`Started task ID ${task.id}...`);
});

queue.on("success:build", function(task) {
	console.log(`Succeeded for ID ${task.id}`);
});

queue.on("failed:build", function(task) {
	console.log(`Failed for ID ${task.id}`);
});

queue.on("finished:build", function(task) {
	console.log(`Completed for ID ${task.id}`);
});

queue.on("concurrencyReached:build", function() {
	//console.log(`!! Reached concurrency limit.`);
});

queue.on("delayed:build", function() {
	//console.log(`!! Delayed due to interval.`);
});

queue.on("queueRunning:build", function() {
	console.log(`## Queue started running...`);
});

queue.on("queueDrained:build", function() {
	console.log(`## Queue drained!`);
});

Promise.map((new Array(20)), function(_, index) {
	return Promise.try(function() {
		return queue.push("build", { id: index });
	}).then(function(result) {
		return "[SUCCESS] " + result;
	}).catch(function(err) {
		return "[ERROR  ] " + err.toString();
	});
}).each(function(message) {
	console.log(message);
});
