'use strict';

var Promise = require("bluebird");
var events = require("events");
var extend = require("extend");
var createError = require("create-error");

var TaskQueueError = createError("TaskQueueError", {
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
	var handlers = {};
	var taskOptions = {};
	var tasks = {};
	var counters = {};
	var starts = {};
	var running = {};

	function tryRunTask(type) {
		var maxTasks = defaultValue(taskOptions[type].concurrency, Infinity);
		var waitTime = remainingInterval(type);

		if (tasks[type].length > 0) {
			if (waitTime <= 0) {
				if (counters[type] < maxTasks) {
					if (running[type] === false) {
						markQueueRunning(type);
					}

					runTask(type);
				} else {
					taskQueue.emit("concurrencyReached:" + type);
				}
			} else {
				taskQueue.emit("delayed:" + type);

				setTimeout(function () {
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
		var taskInterval = defaultValue(taskOptions[type].interval, 0) * 1000;
		var lastTask = defaultValue(starts[type], 0);

		return lastTask + taskInterval - Date.now();
	}

	function runTask(type) {
		var task = tasks[type].shift();

		markStarted(type, task);

		Promise.try(function () {
			return handlers[type](task.data);
		}).then(function (result) {
			markSuccess(type, task);
			task.resolve(result);
		}).catch(function (err) {
			markFailed(type, task);
			task.reject(err);
		}).then(function () {
			tryRunTask(type);
		});
	}

	function markStarted(type, task) {
		counters[type] += 1;
		starts[type] = Date.now();
		taskQueue.emit("started:" + type, task.data);
	}

	function markFinished(type, task) {
		counters[type] -= 1;
		taskQueue.emit("finished:" + type, task.data);
	}

	function markSuccess(type, task) {
		markFinished(type, task);
		taskQueue.emit("success:" + type, task.data);
	}

	function markFailed(type, task) {
		markFinished(type, task);
		taskQueue.emit("failed:" + type, task.data);
	}

	function markQueueRunning(type) {
		taskQueue.emit("queueRunning:" + type);
		running[type] = true;
	}

	function markQueueDrained(type) {
		taskQueue.emit("queueDrained:" + type);
		running[type] = false;
	}

	var taskQueue = extend(new events.EventEmitter(), {
		define: function define(type, handler, options) {
			handlers[type] = handler;
			taskOptions[type] = defaultValue(options, {});
			counters[type] = 0;
			running[type] = false;
		},
		push: function push(type, data) {
			return Promise.try(function () {
				if (handlers[type] == null) {
					throw new TaskQueueError("No such task type exists.");
				}

				var resolveFunc = void 0,
				    rejectFunc = void 0;
				var deferredPromise = new Promise(function (resolve, reject) {
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
			});
		}
	});

	return taskQueue;
};