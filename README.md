# promise-task-queue

A task queue, with:

* __First-class support for Promises__ (any Promises/A+ compatible implementation, including Bluebird, ES6, Q, ...)
* __Concurrency control__
* __Rate-limiting__ (explained further below)
* __Many event hooks__, for easy metrics and reporting

## License

[WTFPL](http://www.wtfpl.net/txt/copying/) or [CC0](https://creativecommons.org/publicdomain/zero/1.0/), whichever you prefer. A donation and/or attribution are appreciated, but not required.

## Donate

My income consists largely of donations for my projects. If this module is useful to you, consider [making a donation](http://cryto.net/~joepie91/donate.html)!

You can donate using Bitcoin, PayPal, Flattr, cash-in-mail, SEPA transfers, and pretty much anything else.

## Contributing

Pull requests welcome. Please make sure your modifications are in line with the overall code style, and ensure that you're editing the files in `src/`, not those in `lib/`.

Build tool of choice is `gulp`; simply run `gulp` while developing, and it will watch for changes.

Be aware that by making a pull request, you agree to release your modifications under the licenses stated above.

## Usage

A simple usage example:

```javascript
var Promise = require("bluebird");
var bhttp = require("bhttp");
var taskQueue = require("promise-task-queue");

var queue = taskQueue();
var failedRequests = 0;

queue.on("failed:apiRequest", function(task) {
	failedRequests += 1;
});

queue.define("apiRequest", function(task) {
	return Promise.try(function() {
		return bhttp.get("http://api.example.com/users/" + task.username, {decodeJSON: true});
	}).then(function(response) {
		return response.body;
	});
}, {
	concurrency: 2
});

Promise.try(function() {
	/* The following queues up the actual task. Note how it returns a Promise! */
	return queue.push("apiRequest", {username: "joepie91"});
}).then(function(jsonResponse) {
	console.log("This user has " + jsonResponse.repositoryCount + " repositories.");
})
```

This example shows a task for making an API request using [`bhttp`](https://www.npmjs.com/package/bhttp), with a maximum concurrency of two tasks running at the same time. It also demonstrates one of the event types.


## Task mechanics

You can define any number of task types. Each task type will have a single queue, with certain optional limits. The specified `handler` determines the task logic, and will be executed for each added task, but only when that task starts.

A 'task' is a plain object, pushed to the queue for a particular task type using `queue.push`. A task is deemed to have 'finished' when it either returns synchronously, or when the Promise it returns has resolved or rejected.

Tasks will execute immediately if allowed by the configured limits, or queue up if not.

## Concurrency control vs. Rate-limiting

The difference between the two, summarized:

* __Concurrency control:__ Controlling how many tasks you can run *at any given moment in time*.
* __Rate-limiting:__ Controlling how many tasks can be started within a certain *amount* of time.

This module supports both, even combined - in which case both conditions must be satisfied.

## Rate-limiting (intervals)

This queue does *not* implement rate-limiting of the "X tasks per Y amount of time" type. Instead, it uses intervals between tasks. This is not without reason, however, and it will almost certainly work for your usecase. If you're not interested in rate-limiting, you'll probably want to skip this section.

The "X tasks per Y amount of time" type of rate-limiting will usually result in a 'burst' of tasks being executed at the same time, followed by a long waiting period. However, in many cases, this isn't what you want at all - and for this reason and to reduce implementation complexity, `promise-task-queue` implements a 'smoothed out' version of rate-limiting instead, where there is a minimum interval between each task.

Say that you make a request to a particular API on behalf of your users, and the API limits you to 30 requests per minute. When using `promise-task-queue`, you would specify the `interval` as `2` seconds, because `60 / 30 == 2`. When you are going over capacity, this will cause a usually short delay for your users - best case, they would be looking at a 2 second delay for their request, if they'd made it right after the average rate limit was hit.

When using a 'bursty' model of rate-limiting, once you go over capacity, the best case is that a user in that same scenario would have to wait *an entire minute* for the next 'batch' of API requests to become available. By 'smoothing out' tasks instead, you avoid this scenario, and your application becomes 'just a bit slow' rather than 'broken', as far as the user is concerned.

Another reason is the aforementioned implementation complexity - one use might want a limit per second, another user might want a limit per minute, then per hour, and so on. This would require implementation of a relatively complex time specification API... and it's much simpler to simply let you specify an interval in seconds, which accommodates all of those usecases. This makes it simpler for everybody involved.

## API

### taskQueue()

Creates a new task queue.

### queue.define(type, handler, [options])

Defines a new task type.

* __type__: The name of the task type, which is used to refer to it in `queue.push` calls and event names.
* __handler__: The function to run when a task of this type starts. This is where the actual task logic goes, and it *must* return either a Promise or a synchronous value. It will receive a single argument, containing the `data` for the task.
* __options__: *Optional.* An object with options, all of them optional.
	* __concurrency__: The maximum amount of tasks of this type that can run at the same time.
	* __interval__: The rate-limiting interval for this task type, *in seconds*. See the explanation in the "Rate-limiting" section for more information.

Keep in mind that if you reject/throw an error from your task handler, it *must* be an `Error` object (or descendant thereof). This is true for Promises and error-handling in general, but is worth repeating. If you're having trouble creating useful errors, try out the [`create-error` module](https://www.npmjs.com/package/create-error).

### queue.push(type, data)

Adds a task to the queue for the given `type`.

* __type__: The name of the task type, as specified in `queue.define`.
* __data__: The task data to pass on - this will be provided to the task handler as the first (and only) callback argument.

Note that this function will __return a Promise__, passing through the result from the task handler. If the Promise from the task handler resolves, then the one returned from this function will resolve with the same value. If the Promise from the task handler is rejected, this one will also reject, with the same error.

### queue.drain(type)

Drains (ie. empties) the queue for the given `type`. Note that this __will not__ try to stop or 'cancel' *running* tasks; it will simply remove the *upcoming* tasks that are still in the queue.

* __type__: The name of the task type, as specified in `queue.define`.

### queue.awaitDrained(type)

Returns a Promise that will resolve when the task queue has run out of tasks for a given `type`. Some of the previously queued tasks may still be running, however - this simply signals that there are no *upcoming* tasks scheduled anymore.

* __type__: The name of the task type, as specified in `queue.define`.

This can be useful for keeping metrics of the queue status.

__Caution:__ The returned Promise will only resolve __exactly once__, as soon as the amount of pending tasks reaches 0 and the queue tries to run the next task - and since the queue cannot distinguish between the origin of tasks, this function will only be useful in cases without concurrency. It will also not work correctly if you add tasks asynchronously and don't handle your asynchronous sequences very carefully.

In short; only use this method if you're very certain that you fully understand - and can predict - the execution order of your (asynchronous) code.

### queue.awaitCompleted(type)

Returns a Promise that will resolve when the task queue has run out of tasks for a given `type`, and all the running tasks have finished.

* __type__: The name of the task type, as specified in `queue.define`.

This is useful for, for example, complex multi-operation build processes, where you want to wait for all existing tasks to finish before moving on.

__Caution:__ The returned Promise will only resolve __exactly once__, as soon as the last running task finishes and there are no tasks left in the queue - and since the queue cannot distinguish between the origin of tasks, this function will only be useful in cases without concurrency. It will also not work correctly if you add tasks asynchronously and don't handle your asynchronous sequences very carefully.

In short; only use this method if you're very certain that you fully understand - and can predict - the execution order of your (asynchronous) code.

### Events

All of these events are emitted on the `queue` object. Where you see `$type` in an event name, this will be replaced with the task type that it occurred for. For example, for an `apiRequest` task type, you might see a `failed:apiRequest` event.

__Important:__ Keep in mind that for the `finished`, `success` and `failed` events, you usually want to use the Promise that is returned from `queue.push` instead - these events exists primarily for purposes like keeping metrics, and trying to use them in the regular task-queueing process will make your code a mess.

#### 'started:$type'

Emitted when a task is started. The first (and only) argument to the event handler will be the `data` for the task.

#### 'finished:$type'

Emitted when a task has finished, regardless of whether it was successful. The first (and only) argument to the event handler will be the `data` for the task.

#### 'success:$type'

Emitted when a task has finished, but *only* when it was successful - ie. the returned Promise *resolved*. The first (and only) argument to the event handler will be the `data` for the task.

#### 'failed:$type'

Emitted when a task has finished, but *only* when it failed - ie. the returned Promise *rejected*. The first (and only) argument to the event handler will be the `data` for the task.

#### 'queueRunning:$type'

Emitted when the queue for this task type starts running, while it was previously drained (ie. empty). No arguments are passed to the event handler.

#### 'queueDrained:$type'

Emitted when the queue for this task type has drained (ie. ran out of queued tasks). Some of the tasks may still be running, however. No arguments are passed to the event handler.

#### 'queueCompleted:$type'

Emitted when the queue for this task type has fully completed (ie. the queue has drained, and all running tasks have finished). No arguments are passed to the event handler.

#### 'delayed:$type'

Emitted when a task has been delayed because of the `interval` rate-limit. Note that this event may currently be emitted *many* times if many tasks are queued.

#### 'concurrencyReached:$type'

Emitted when a task has been queued up because of the `concurrency` limit. Can be useful to detect when your queue is backing up.

## Changelog

* __1.2.0:__ Various changes:
	* Added `awaitCompleted` and `drain` methods, and `queueCompleted` event.
	* Fixed the `awaitDrained` Promise never resolving.
	* Added debugging statements in the code.
* __1.1.1:__ Fixed typo in the example; unit in the API rate limit should've been 'per minute', not 'per second'.
* __1.1.0:__ Added `awaitDrained` method.
* __1.0.0:__ Initial release.