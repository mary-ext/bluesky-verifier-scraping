import { Did } from '@atcute/lexicons/syntax';
import * as v from 'valibot';

import { type Source } from '../sources.ts';
import { type VerifierEntry, type VerifiersFile, verifiersFile } from '../types.ts';

// display order; Bluesky leads as the primary AppView
const order = ['bluesky', 'blacksky'] as const satisfies readonly Source[];

const TIME_RE = /^Last updated: .*$/m;

const escape = (value: string) => {
	return value.replace(/[<&|]/g, (char) => '&#' + char.charCodeAt(0) + ';');
};

let data: VerifiersFile;
{
	const raw = await Deno.readTextFile('verifiers.json');
	const json = JSON.parse(raw);

	data = v.parse(verifiersFile, json);
}

const collator = new Intl.Collator('en-US');

// a verifier trusted by several sources is listed once, under the highest-priority source that trusts it
const primarySource = (verifier: VerifierEntry) => {
	return order.find((source) => verifier.sources[source] !== undefined);
};

const renderTable = (source: Source) => {
	const entries = (Object.entries(data.verifiers) as [Did, VerifierEntry][])
		.filter(([, verifier]) => primarySource(verifier) === source)
		.map(([did, verifier]) => ({ did, ...verifier }))
		.sort((a, b) => {
			return collator.compare(a.profile.name || a.profile.handle, b.profile.name || b.profile.handle);
		});

	let table = `| Account |\n| ------- |\n`;

	for (const entry of entries) {
		const profile = entry.profile;

		const url = `https://bsky.app/profile/${entry.did}`;
		const valid = entry.sources[source] === 'valid' ? `✅` : `❌`;
		const link = `<a href="${escape(url)}">${
			profile.name?.trim()
				? `<b>${escape(profile.name)}</b> (@${escape(profile.handle)})`
				: `@${escape(profile.handle)}`
		}</a>`;

		table += `| ${valid} ${link} |\n`;
	}

	return table;
};

const buildDocument = (time: string) => {
	const sections = order
		.map((source) => {
			const label = source[0].toUpperCase() + source.slice(1);
			return `## ${label}\n\n${renderTable(source)}`;
		})
		.join('\n');

	return `# Bluesky verified accounts\n\n` +
		`Last updated: ${time}[^1]\n\n` +
		`${sections}\n` +
		`[^1]: Reflecting actual changes, not when the scraper was last run\n`;
};

{
	const next = buildDocument(new Date().toISOString());

	let shouldWrite = true;
	try {
		const current = await Deno.readTextFile('README.md');

		// ignore the timestamp line so the readme only changes when the tables actually change
		if (current.replace(TIME_RE, '') === next.replace(TIME_RE, '')) {
			shouldWrite = false;
		}
	} catch (err) {
		if (!(err instanceof Deno.errors.NotFound)) {
			throw err;
		}
	}

	if (shouldWrite) {
		await Deno.writeTextFile('README.md', next);
		console.log(`wrote to readme`);
	} else {
		console.log(`writing skipped`);
	}
}
