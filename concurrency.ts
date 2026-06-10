/**
 * Schedules a task on a concurrency-limited pool.
 *
 * @param task the work to run once a slot is free
 * @returns the task's result
 */
export type Pool = <T>(task: () => Promise<T>) => Promise<T>;

type Waiter = {
	next: Waiter | undefined;
	wake: () => void;
};

/**
 * Creates a scoped pool that caps how many tasks run concurrently. Tasks scheduled beyond the limit queue
 * and start as running tasks settle, in submission order.
 *
 * @param limit maximum number of tasks allowed to run at once
 * @returns a function that schedules a task on the pool
 */
export const createPool = (limit: number): Pool => {
	let active = 0;
	let head: Waiter | undefined;
	let tail: Waiter | undefined;

	const release = () => {
		active -= 1;

		const waiter = head;
		if (waiter !== undefined) {
			head = waiter.next;
			if (head === undefined) {
				tail = undefined;
			}

			active += 1;
			waiter.wake();
		}
	};

	return (task) => {
		const run = async () => {
			try {
				return await task();
			} finally {
				release();
			}
		};

		if (active < limit) {
			active += 1;
			return run();
		}

		return new Promise<void>((resolve) => {
			const waiter: Waiter = { next: undefined, wake: resolve };
			if (tail !== undefined) {
				tail.next = waiter;
			} else {
				head = waiter;
			}
			tail = waiter;
		}).then(run);
	};
};
