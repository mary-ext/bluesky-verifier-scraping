import type {} from '@atcute/atproto';
import type {} from '@atcute/bluesky';

import { Client, ok, simpleFetchHandler } from '@atcute/client';
import { Did } from '@atcute/lexicons';

import { type State, stateSchema, type VerificationEntry } from '../types.ts';

const now = Date.now();

let state: State | undefined;
jmp: try {
	const raw = await Deno.readTextFile('state.json');
	const json = JSON.parse(raw);

	state = stateSchema.parse(json, { mode: 'strip' });
} catch (err) {
	if (err instanceof Deno.errors.NotFound) {
		break jmp;
	}

	throw err;
}

const dids = new Map(
	state ? Object.entries(state.dids) as [did: Did, entry: VerificationEntry][] : undefined,
);

const relay = new Client({
	handler: simpleFetchHandler({ service: 'https://relay1.us-west.bsky.network' }),
});

const appview = new Client({
	handler: simpleFetchHandler({ service: 'https://public.api.bsky.app' }),
});

let repoCursor: string | undefined;
do {
	const backfills = await ok(
		relay.get('com.atproto.sync.listReposByCollection', {
			headers: {
				'user-agent': 'github:mary-ext/bluesky-verifier-scraping',
			},
			params: {
				collection: 'app.bsky.graph.verification',
				cursor: repoCursor,
				limit: 2_000,
			},
		}),
	);

	repoCursor = backfills.cursor;

	for (const { did } of backfills.repos) {
		console.log(`processing ${did}`);

		const prev = dids.get(did);

		while (true) {
			const response = await appview.get('app.bsky.actor.getProfile', {
				headers: {
					'user-agent': 'github:mary-ext/bluesky-verifier-scraping',
				},
				params: {
					actor: did,
				},
			});

			if (!response.ok) {
				if (response.status === 429) {
					console.log(`  ratelimited`);
					await new Promise((resolve) => setTimeout(resolve, 5_000));
					continue;
				}

				if (response.status === 400) {
					console.log(`  gone (account nonexistent)`);

					if (prev !== undefined) {
						dids.delete(did);
					}
					break;
				}

				console.log(`  skip (http ${response.status})`);
				break;
			}

			const profile = response.data;
			const trustedVerifier = profile.verification?.trustedVerifierStatus ?? 'none';

			let valid: boolean | undefined;
			switch (trustedVerifier) {
				case 'none': {
					console.log(`  gone (not a verifier)`);
					dids.delete(did);
					break;
				}
				case 'invalid': {
					console.log(`  trusted (marked as impersonation)`);
					valid = false;
					break;
				}
				case 'valid': {
					console.log(`  trusted`);
					valid = true;
					break;
				}
				default: {
					console.log(`  unknown verifier status (${trustedVerifier})`);
					valid = undefined;
					break;
				}
			}

			const next: VerificationEntry = {
				at: prev?.at ?? now,
				profile: {
					name: profile.displayName,
					handle: profile.handle,
				},
				valid: valid,
			};

			dids.set(did, next);
			break;
		}
	}
} while (repoCursor !== undefined);

state = {
	dids: Object.fromEntries(
		Array.from(dids).sort(([a], [b]) => {
			if (a < b) {
				return -1;
			}
			if (a > b) {
				return 1;
			}

			return 0;
		}),
	),
};

{
	const json = JSON.stringify(state, null, '\t');
	await Deno.writeTextFile('state.json', json);
}
