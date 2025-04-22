import '@atcute/bluesky/lexicons';
import { simpleFetchHandler } from '@atcute/client';
import { At } from '@atcute/client/lexicons';

import { Client } from '../src/client.ts';
import { APPVIEW_URL, DEFAULT_HEADERS } from '../src/constants.ts';
import { DidInfo, SerializedState, serializedState } from '../src/state.ts';

const client = new Client({ handler: simpleFetchHandler({ service: APPVIEW_URL }) });

const STATE_FILE = Deno.env.get('STATE_FILE');
if (STATE_FILE === undefined) {
	throw new Error(`missing STATE_FILE environment variable`);
}

let state: SerializedState | undefined;

// Read existing state file
{
	let json: unknown;

	try {
		const source = await Deno.readTextFile(STATE_FILE);
		json = JSON.parse(source);
	} catch {
		/* empty */
	}

	if (json !== undefined) {
		state = serializedState.parse(json);
	}
}

const dids = new Map<string, DidInfo>(state ? Object.entries(state.dids) : []);

for (const [did, info] of dids) {
	while (true) {
		const response = await client.get('app.bsky.actor.getProfile', {
			headers: DEFAULT_HEADERS,
			params: {
				actor: did as At.Did,
			},
		});

		if (!response.ok) {
			if (response.status === 429) {
				console.log(`${did}: ratelimited`);
				await new Promise((resolve) => setTimeout(resolve, 5_000));
				continue;
			}

			if (response.status === 400) {
				console.log(`${did}: gone (account nonexistent)`);
				dids.delete(did);
				break;
			}

			console.log(`${did}: skip (http ${response.status})`);
			break;
		}

		const data = response.data;
		const trustedVerifier = data.verification?.trustedVerifierStatus ?? 'none';

		info.profile = {
			name: data.displayName,
			handle: data.handle,
		};

		switch (trustedVerifier) {
			case 'none': {
				console.log(`${did}: gone (not a verifier)`);
				dids.delete(did);
				break;
			}
			case 'invalid': {
				console.log(`${did}: trusted (marked as impersonation)`);
				info.valid = false;
				break;
			}
			case 'valid': {
				console.log(`${did}: trusted`);
				info.valid = true;
				break;
			}
			default: {
				console.log(`${did}: unknown verifier status (${trustedVerifier})`);
				info.valid = undefined;
				break;
			}
		}

		break;
	}
}

{
	// Persist the state
	{
		const serialized: SerializedState = {
			jetstream: {
				cursor: state?.jetstream.cursor,
			},
			dids: Object.fromEntries(Array.from(dids)),
		};

		await Deno.writeTextFile(STATE_FILE, JSON.stringify(serialized, null, '\t'));
	}
}
