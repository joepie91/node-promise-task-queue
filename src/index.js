'use strict';

const Promise = require("bluebird");
const events = require("events");
const extend = require("extend");
const createError = require("create-error");
const debugLoop = require("debug")("promise-task-queue:loop");
const debugTasks = require("debug")("promise-task-queue:tasks");
const util = require("util");

function debugObject(obj) {
	return util.inspect(obj, {depth: null, colors: true}).replace(/\n|\r/g, "");
}

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
						debugLoop(`Queue for '${type}' is now running`);
						markQueueRunning(type);
					}
					
					runTask(type);
				} else {
					debugLoop(`Reached concurrency for '${type}'`);
					taskQueue.emit(`concurrencyReached:${type}`);
				}
			} else {
				debugLoop(`Registering queue delay for '${type}'`);
				taskQueue.emit(`delayed:${type}`);
				
				setTimeout(() => {
					tryRunTask(type);
				}, waitTime);
			}
		} else {
			if (running[type] === true) {
				debugLoop(`Queue for '${type}' has now stopped`);
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
			task.resolve(result);
			markSuccess(type, task);
		}).catch((err) => {
			markFailed(type, task);
			task.reject(err);
		}).then(function(){
			tryRunTask(type);
		});
	}
	
	function markStarted(type, task) {
		debugTasks(`markStarted (${type}): ${debugObject(task.data)}`);
		counters[type] += 1;
		starts[type] = Date.now();
		taskQueue.emit(`started:${type}`, task.data);
	}
	
	function markFinished(type, task) {
		debugTasks(`markFinished (${type}): ${debugObject(task.data)}`);
		counters[type] -= 1;
		taskQueue.emit(`finished:${type}`, task.data);
		checkCompletion(type);
	}
	
	function markSuccess(type, task) {
		debugTasks(`markSuccess (${type}): ${debugObject(task.data)}`);
		markFinished(type, task);
		taskQueue.emit(`success:${type}`, task.data);
	}
	
	function markFailed(type, task) {
		debugTasks(`markFailed (${type}): ${debugObject(task.data)}`);
		markFinished(type, task);
		taskQueue.emit(`failed:${type}`, task.data);
	}
	
	function markQueueRunning(type) {
		debugLoop(`markQueueRunning (${type})`);
		taskQueue.emit(`queueRunning:${type}`);
		running[type] = true;
	}
	
	function markQueueDrained(type) {
		debugLoop(`markQueueDrained (${type})`);
		taskQueue.emit(`queueDrained:${type}`);
		running[type] = false;
	}
	
	function markQueueCompleted(type) {
		debugLoop(`markQueueCompleted (${type})`);
		taskQueue.emit(`queueCompleted:${type}`);
	}

	function checkCompletion(type) {
		if (tasks[type].length === 0 && counters[type] === 0) {
			markQueueCompleted(type);
		}
	}

	let taskQueue = extend(new events.EventEmitter(), {
		define: function(type, handler, options) {
			if (handlers[type] != null) {
				throw new TaskQueueError(`The '${type}' task type already exists.`)
			}

			handlers[type] = handler;
			taskOptions[type] = defaultValue(options, {});
			counters[type] = 0;
			running[type] = false;
			tasks[type] = [];
		},
		push: function(type, data) {
			return Promise.try(() => {
				if (handlers[type] == null) {
					throw new TaskQueueError("No such task type exists.")
				}
				
				debugTasks(`Queueing new task for '${type}': ${debugObject(data)}`);

				let resolveFunc, rejectFunc;
				let deferredPromise = new Promise((resolve, reject) => {
					resolveFunc = resolve;
					rejectFunc = reject;
				});

				tasks[type].push({
					data: data,
					resolve: resolveFunc,
					reject: rejectFunc
				});
				
				tryRunTask(type);
				
				return deferredPromise;
			})
		},
		drain: function(type) {
			if (handlers[type] == null) {
				throw new TaskQueueError("No such task type exists.")
			}

			debugTasks(`Draining tasks for '${type}'`);
			tasks[type] = [];
		},
		awaitDrained: function(type) {
			return Promise.try(() => {
				if (handlers[type] == null) {
					throw new TaskQueueError("No such task type exists.")
				}

				debugLoop(`awaitDrained requested for '${type}'`);

				if (tasks[type].length === 0) {
					debugLoop(`Queue for '${type}' is already drained`);
					return;
				} else {
					debugLoop(`Returning awaitDrained Promise for '${type}'`);
					return new Promise((resolve, reject) => {
						this.on(`queueDrained:${type}`, () => {
							debugLoop(`Resolving awaitDrained Promise for '${type}'`);
							resolve();
						})
					})
				}
			})
		},
		awaitCompleted: function(type) {
			return Promise.try(() => {
				if (handlers[type] == null) {
					throw new TaskQueueError("No such task type exists.")
				}

				debugLoop(`awaitCompleted requested for '${type}'`);

				if (tasks[type].length === 0 && counters[type] === 0) {
					debugLoop(`Queue for '${type}' is already completed`);
					return;
				} else {
					debugLoop(`Returning awaitCompleted Promise for '${type}'`);
					return new Promise((resolve, reject) => {
						this.on(`queueCompleted:${type}`, () => {
							debugLoop(`Resolving awaitCompleted Promise for '${type}'`);
							resolve();
						})
					})
				}
			})
		}
	});
	
	return taskQueue;
}
