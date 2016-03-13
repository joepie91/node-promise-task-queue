'use strict';

const Promise = require("bluebird");
const events = require("events");
const extend = require("extend");
const createError = require("create-error");

const TaskQueueError = createError("TaskQueueError", {
	code: "TaskQueueError"
});

function defaultValue(value, defaultVal) {
	if (value != null) {
		return value;
	} else {
		return defaultVal;
	}
}

module.exports = function createTaskQueue(options) {
	let handlers = {};
	let taskOptions = {};
	let tasks = {};
	let counters = {};
	let starts = {};
	let running = {};
	
	function tryRunTask(type) {
		let maxTasks = defaultValue(taskOptions[type].concurrency, Infinity);
		let waitTime = remainingInterval(type);
		
		if (tasks[type].length > 0) {
			if (waitTime <= 0) {
				if (counters[type] < maxTasks) {
					if (running[type] === false) {
						markQueueRunning(type);
					}
					
					runTask(type);
				} else {
					taskQueue.emit(`concurrencyReached:${type}`);
				}
			} else {
				taskQueue.emit(`delayed:${type}`);
				
				setTimeout(() => {
					tryRunTask(type);
				}, waitTime);
			}
		} else {
			if (running[type] === true) {
				markQueueDrained(type);
			}
		}
	}
	
	function remainingInterval(type) {
		let taskInterval = defaultValue(taskOptions[type].interval, 0) * 1000;
		let lastTask = defaultValue(starts[type], 0);
		
		return (lastTask + taskInterval) - Date.now();
	}
	
	function runTask(type) {
		let task = tasks[type].shift();
		
		markStarted(type, task);
		
		Promise.try(() => {
			return handlers[type](task.data);
		}).then((result) => {
			markSuccess(type, task);
			task.resolve(result);
		}).catch((err) => {
			markFailed(type, task);
			task.reject(err);
		}).then(function(){
			tryRunTask(type);
		});
	}
	
	function markStarted(type, task) {
		counters[type] += 1;
		starts[type] = Date.now();
		taskQueue.emit(`started:${type}`, task.data);
	}
	
	function markFinished(type, task) {
		counters[type] -= 1;
		taskQueue.emit(`finished:${type}`, task.data);
	}
	
	function markSuccess(type, task) {
		markFinished(type, task);
		taskQueue.emit(`success:${type}`, task.data);
	}
	
	function markFailed(type, task) {
		markFinished(type, task);
		taskQueue.emit(`failed:${type}`, task.data);
	}
	
	function markQueueRunning(type) {
		taskQueue.emit(`queueRunning:${type}`);
		running[type] = true;
	}
	
	function markQueueDrained(type) {
		taskQueue.emit(`queueDrained:${type}`);
		running[type] = false;
	}
	
	let taskQueue = extend(new events.EventEmitter(), {
		define: function(type, handler, options) {
			handlers[type] = handler;
			taskOptions[type] = defaultValue(options, {});
			counters[type] = 0;
			running[type] = false;
		},
		push: function(type, data) {
			return Promise.try(() => {
				if (handlers[type] == null) {
					throw new TaskQueueError("No such task type exists.")
				}
				
				let resolveFunc, rejectFunc;
				let deferredPromise = new Promise((resolve, reject) => {
					resolveFunc = resolve;
					rejectFunc = reject;
				});
				
				if (tasks[type] == null) {
					tasks[type] = [];
				}
				
				tasks[type].push({
					data: data,
					resolve: resolveFunc,
					reject: rejectFunc
				});
				
				tryRunTask(type);
				
				return deferredPromise;
			})
		}
	});
	
	return taskQueue;
}