import '@atcute/bluesky/lexicons';
import { At } from '@atcute/client/lexicons';

import { JETSTREAM_URL } from '../src/constants.ts';
import { DidInfo, SerializedState, serializedState } from '../src/state.ts';
import { createWebSocketStream } from '../src/utils/websocket.ts';

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

let jetstreamCursor = state?.jetstream.cursor;

// Watch the relay for any verification records
{
	// run it 5 seconds back
	let cursor: number | undefined = Math.max(0, (jetstreamCursor ?? 0) - 5 * 1_000_000);
	let throttled = false;

	console.log(`listening to relay`);
	console.log(`  connecting to ${JETSTREAM_URL}`);
	console.log(`  starting ${cursor || `<root>`}`);

	const url = JETSTREAM_URL + `?cursor=${cursor}` + `&wantedCollections=app.bsky.graph.verification`;

	for await (const data of createWebSocketStream<JetstreamEvent>(url)) {
		if (data.time_us > cursor) {
			cursor = data.time_us;
		}

		if (cursor / 1_000_000 > Date.now() / 1_000 - 3) {
			break;
		}

		if (!throttled) {
			throttled = true;
			Deno.unrefTimer(setTimeout(() => (throttled = false), 60_000));

			console.log(`  at ${new Date(cursor / 1_000).toISOString()}`);
		}

		const kind = data.kind;
		if (kind === 'commit') {
			const commit = data.commit;

			if (commit.collection == 'app.bsky.graph.verification') {
				const did = data.did;
				const info = dids.get(did);

				if (info === undefined) {
					console.log(`  found ${did}`);
					dids.set(did, { at: Math.floor(cursor / 1_000) });
				}
			}
		}
	}

	console.log(`  ending ${cursor || `<root>`}`);

	jetstreamCursor = cursor;

	type JetstreamEvent = AccountEvent | IdentityEvent | CommitEvent;

	interface AccountEvent {
		kind: 'account';
		did: At.Did;
		time_us: number;
		account: {
			seq: number;
			did: At.Did;
			time: string;
			active: boolean;
		};
	}

	interface IdentityEvent {
		kind: 'identity';
		did: At.Did;
		time_us: number;
		identity: {
			seq: number;
			did: At.Did;
			time: string;
			handle?: string;
		};
	}

	interface CommitEvent {
		kind: 'commit';
		did: At.Did;
		time_us: number;
		commit: {
			rev: '3l3qo2vutsw2b';
			operation: 'create';
			collection: At.Nsid;
			rkey: At.RecordKey;
			record: unknown;
			cid: At.Cid;
		};
	}
}

// Persist the state
{
	const serialized: SerializedState = {
		jetstream: {
			cursor: jetstreamCursor,
		},
		dids: Object.fromEntries(Array.from(dids)),
	};

	await Deno.writeTextFile(STATE_FILE, JSON.stringify(serialized, null, '\t'));
}
