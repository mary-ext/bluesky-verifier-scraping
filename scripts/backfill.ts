import type {} from '@atcute/atproto';
import type { AppBskyGraphVerification } from '@atcute/bluesky';

import { Client, ok, simpleFetchHandler } from '@atcute/client';
import { getPdsEndpoint, isPlcDid, isWebDid } from '@atcute/identity';
import {
	CompositeDidDocumentResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
} from '@atcute/identity-resolver';
import { Did, isDid } from '@atcute/lexicons/syntax';

import { createPool } from '../concurrency.ts';
import { type Source, sources } from '../sources.ts';
import { type Profile, type SubjectProfile, type VerifiedSubject, type VerifiersFile } from '../types.ts';

const now = Date.now();

const USER_AGENT = 'github:mary-ext/bluesky-verifier-scraping';
const RELAY_SERVICE = 'https://relay1.us-west.bsky.network';

// number of in-flight appview/PDS requests; bounded to stay within unauthenticated rate limits
const CONCURRENCY = 8;

// max actors accepted by app.bsky.actor.getProfiles in a single call
const PROFILE_BATCH = 25;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// JSON.stringify replacer that recursively sorts every object's keys, keeping the serialized state stable
// regardless of insertion order as the shape grows
const sortKeys = (_key: string, value: unknown) => {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return value;
	}

	return Object.fromEntries(
		Object.entries(value).sort(([a], [b]) => {
			if (a < b) {
				return -1;
			}
			if (a > b) {
				return 1;
			}

			return 0;
		}),
	);
};

// #region prior state

// carry first-seen timestamps forward across runs so re-scraping does not reset every verifier's "since"
// history to the current run
const previousAt = new Map<Did, number>();
try {
	const raw = await Deno.readTextFile('verifiers.json');
	const json = JSON.parse(raw) as { verifiers?: Record<string, { at?: unknown }> };

	const entries = json.verifiers;
	if (entries !== undefined) {
		for (const did in entries) {
			const at = entries[did]?.at;
			if (isDid(did) && typeof at === 'number') {
				previousAt.set(did, at);
			}
		}
	}
} catch (err) {
	if (!(err instanceof Deno.errors.NotFound)) {
		throw err;
	}
}

// #endregion

// #region clients

const relay = new Client({ handler: simpleFetchHandler({ service: RELAY_SERVICE }) });

const appviews = Object.fromEntries(
	(Object.keys(sources) as Source[]).map((source) => {
		return [source, new Client({ handler: simpleFetchHandler({ service: sources[source] }) })];
	}),
) as Record<Source, Client>;

const docResolver = new CompositeDidDocumentResolver({
	methods: {
		plc: new PlcDidDocumentResolver(),
		web: new WebDidDocumentResolver(),
	},
});

const pool = createPool(CONCURRENCY);

const getProfile = async (client: Client, did: Did) => {
	while (true) {
		const response = await client.get('app.bsky.actor.getProfile', {
			headers: { 'user-agent': USER_AGENT },
			params: { actor: did },
		});

		if (response.status === 429) {
			await sleep(5_000);
			continue;
		}

		return response;
	}
};

const resolvePds = async (did: Did): Promise<string | undefined> => {
	if (isPlcDid(did) || isWebDid(did)) {
		const doc = await docResolver.resolve(did);
		return getPdsEndpoint(doc);
	}

	return undefined;
};

// #endregion

// #region enumerate candidates

const candidates: Did[] = [];
{
	let cursor: string | undefined;
	do {
		const page = await ok(
			relay.get('com.atproto.sync.listReposByCollection', {
				headers: { 'user-agent': USER_AGENT },
				params: {
					collection: 'app.bsky.graph.verification',
					cursor: cursor,
					limit: 2_000,
				},
			}),
		);

		cursor = page.cursor;

		for (const { did } of page.repos) {
			candidates.push(did);
		}
	} while (cursor !== undefined);
}

console.log(`found ${candidates.length} repos holding verification records`);

// #endregion

// #region per-source verifier status

type Verifier = {
	at: number;
	profile: Profile;
	sources: Partial<Record<Source, 'invalid' | 'valid'>>;
};

const verifiers = new Map<Did, Verifier>();

await Promise.all(candidates.map((did) => {
	return pool(async () => {
		const statuses: Partial<Record<Source, 'invalid' | 'valid'>> = {};
		let profile: Profile | undefined;

		for (const source of Object.keys(sources) as Source[]) {
			const response = await getProfile(appviews[source], did);
			if (!response.ok) {
				if (response.status !== 400) {
					console.log(`  ${did}: ${source} responded http ${response.status}`);
				}
				continue;
			}

			const data = response.data;

			// every source reports the same network-level handle/name; prefer Bluesky's view when present
			if (profile === undefined || source === 'bluesky') {
				profile = { handle: data.handle, name: data.displayName || undefined };
			}

			switch (data.verification?.trustedVerifierStatus) {
				case 'invalid': {
					statuses[source] = 'invalid';
					break;
				}
				case 'valid': {
					statuses[source] = 'valid';
					break;
				}
			}
		}

		if (profile === undefined || Object.keys(statuses).length === 0) {
			return;
		}

		verifiers.set(did, {
			at: previousAt.get(did) ?? now,
			profile: profile,
			sources: statuses,
		});
	});
}));

console.log(`${verifiers.size} verifiers trusted by at least one source`);

// #endregion

// #region verification records

type RawVerification = {
	at: number;
	displayName: string;
	handle: string;
	subject: Did;
};

const recordsByVerifier = new Map<Did, RawVerification[]>();

await Promise.all(
	Array.from(verifiers.keys()).map((did) => {
		return pool(async () => {
			let pds: string | undefined;
			try {
				pds = await resolvePds(did);
			} catch {
				pds = undefined;
			}

			if (pds === undefined) {
				console.log(`  ${did}: could not resolve pds`);
				recordsByVerifier.set(did, []);
				return;
			}

			const repo = new Client({ handler: simpleFetchHandler({ service: pds }) });
			const records: RawVerification[] = [];

			let cursor: string | undefined;
			while (true) {
				const response = await repo.get('com.atproto.repo.listRecords', {
					headers: { 'user-agent': USER_AGENT },
					params: {
						collection: 'app.bsky.graph.verification',
						cursor: cursor,
						limit: 100,
						repo: did,
					},
				});

				if (!response.ok) {
					if (response.status === 429) {
						await sleep(5_000);
						continue;
					}

					console.log(`  ${did}: listRecords responded http ${response.status}`);
					break;
				}

				for (const { value } of response.data.records) {
					const record = value as AppBskyGraphVerification.Main;
					const at = new Date(record.createdAt).getTime();

					records.push({
						at: Number.isNaN(at) ? now : at,
						displayName: record.displayName,
						handle: record.handle,
						subject: record.subject,
					});
				}

				cursor = response.data.cursor;
				if (cursor === undefined) {
					break;
				}
			}

			recordsByVerifier.set(did, records);
		});
	}),
);

// #endregion

// #region enrich verified accounts

const subjects = new Set<Did>();
for (const records of recordsByVerifier.values()) {
	for (const { subject } of records) {
		subjects.add(subject);
	}
}

console.log(`enriching ${subjects.size} unique verified accounts`);

const profiles = new Map<Did, SubjectProfile>();
{
	const all = Array.from(subjects);
	const batches: Did[][] = [];
	for (let i = 0; i < all.length; i += PROFILE_BATCH) {
		batches.push(all.slice(i, i + PROFILE_BATCH));
	}

	await Promise.all(batches.map((batch) => {
		return pool(async () => {
			let response;
			while (true) {
				response = await appviews.bluesky.get('app.bsky.actor.getProfiles', {
					headers: { 'user-agent': USER_AGENT },
					params: { actors: batch },
				});

				if (response.status === 429) {
					await sleep(5_000);
					continue;
				}

				break;
			}

			if (!response.ok) {
				console.log(`  getProfiles responded http ${response.status}`);
				return;
			}

			for (const data of response.data.profiles) {
				profiles.set(data.did, { handle: data.handle, name: data.displayName || undefined });
			}
		});
	}));
}

// invert the issuer -> subject records into one entry per subject, collecting every verifier that issued a
// verification for it. the live profile is preferred; the record-embedded profile (handle/name at
// verification time) of the most recent verification is the fallback when the account is gone, so the
// relationship is never dropped
type SubjectEntry = {
	fallback: { at: number; profile: SubjectProfile };
	verifiedBy: Record<Did, { at: number }>;
};

const bySubject = new Map<Did, SubjectEntry>();
for (const [issuer, records] of recordsByVerifier) {
	for (const record of records) {
		let entry = bySubject.get(record.subject);
		if (entry === undefined) {
			entry = { fallback: { at: -Infinity, profile: { handle: '' } }, verifiedBy: {} };
			bySubject.set(record.subject, entry);
		}

		entry.verifiedBy[issuer] = { at: record.at };

		if (record.at > entry.fallback.at) {
			entry.fallback = {
				at: record.at,
				profile: { handle: record.handle, name: record.displayName || undefined },
			};
		}
	}
}

// #endregion

// #region persist

{
	const file: VerifiersFile = {
		verifiers: Object.fromEntries(verifiers) as VerifiersFile['verifiers'],
	};

	const json = JSON.stringify(file, sortKeys, '\t');
	await Deno.writeTextFile('verifiers.json', json);
}

// rewrite the verified/ tree from scratch so subjects that lost their last verification leave no stale file
{
	try {
		await Deno.remove('verified', { recursive: true });
	} catch (err) {
		if (!(err instanceof Deno.errors.NotFound)) {
			throw err;
		}
	}

	const created = new Set<string>();
	for (const [subject, entry] of bySubject) {
		const data: VerifiedSubject = {
			profile: profiles.get(subject) ?? entry.fallback.profile,
			verifiedBy: entry.verifiedBy,
		};

		// did:plc:abc -> verified/plc/abc.json, did:web:host -> verified/web/host.json
		const path = `verified/${subject.slice(4).replaceAll(':', '/')}.json`;
		const dir = path.slice(0, path.lastIndexOf('/'));
		if (!created.has(dir)) {
			await Deno.mkdir(dir, { recursive: true });
			created.add(dir);
		}

		await Deno.writeTextFile(path, JSON.stringify(data, sortKeys, '\t'));
	}
}

// #endregion
