export class XRPCRatelimiter {
	#limit = 2;
	#duration = 1_000;

	#remaining = this.#limit;
	#resetTime = Date.now() + this.#duration * 1_000;

	update(headers: Headers): void {
		const limit = headers.get('ratelimit-limit');
		const remaining = headers.get('ratelimit-remaining');
		const reset = headers.get('ratelimit-reset');
		const policy = headers.get('ratelimit-policy');

		if (limit) {
			this.#limit = parseInt(limit, 10);
		}

		if (remaining) {
			this.#remaining = parseInt(remaining, 10);
		}

		if (reset) {
			this.#resetTime = parseInt(reset, 10) * 1_000;
		}

		if (policy) {
			// Policy looks like "100;w=60"
			const match = /;w=(\d+)/.exec(policy);
			if (match) {
				this.#duration = parseInt(match[1], 10);
			}
		}
	}

	async wait(): Promise<void> {
		const now = Date.now();

		if (now >= this.#resetTime) {
			this.#remaining = this.#limit;
			this.#resetTime = now + this.#duration * 1_000;
		}

		if (this.#remaining > 0) {
			this.#remaining--;
			return;
		}

		const msToWait = this.#resetTime - now;
		if (msToWait > 0) {
			await new Promise((resolve) => setTimeout(resolve, msToWait));
		}

		this.#remaining = this.#limit - 1;
		this.#resetTime = Date.now() + this.#duration * 1_000;
	}
}
