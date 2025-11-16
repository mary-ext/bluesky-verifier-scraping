import { Did } from '@atcute/lexicons';

import { type State, stateSchema, type VerificationEntry } from '../types.ts';

let state: State;
try {
	const raw = await Deno.readTextFile('state.json');
	const json = JSON.parse(raw);

	state = stateSchema.parse(json, { mode: 'strip' });
} catch (err) {
	throw err;
}

{
	const TABLE_RE = /(?<=<!-- table-start -->)[^]*(?=<!-- table-end -->)/;

	const template = `# Bluesky verified accounts

Last updated: {{time}}[^1]

<!-- table-start --><!-- table-end -->

[^1]: Reflecting actual changes, not when the scraper was last run
`;

	let table = `
| Account |
| ------- |
`;

	const collator = new Intl.Collator('en-US');
	const accounts = (Object.entries(state.dids) as [did: Did, entry: VerificationEntry][])
		.map(([did, acc]) => ({ ...acc, did }))
		.sort((a, b) => collator.compare(a.profile.name || a.profile.handle, b.profile.name || b.profile.handle));

	for (const account of accounts) {
		const profile = account.profile;

		const url = `https://bsky.app/profile/${account.did}`;
		const valid = account.valid ? `✅` : `❌`;
		const link = `<a href="${escape(url)}">${
			profile.name?.trim()
				? `<b>${escape(profile.name)}</b> (@${escape(profile.handle)})`
				: `@${escape(profile.handle)}`
		}</a>`;

		table += `| ${valid} ${link} |\n`;
	}

	let shouldWrite = true;

	try {
		const source = await Deno.readTextFile('README.md');

		if (TABLE_RE.exec(source)?.[0] === table) {
			shouldWrite = false;
		}
		// deno-lint-ignore no-empty
	} catch {}

	// Write the markdown file
	if (shouldWrite) {
		const final = template.replace('{{time}}', new Date().toISOString()).replace(TABLE_RE, table);

		await Deno.writeTextFile('README.md', final);
		console.log(`wrote to readme`);
	} else {
		console.log(`writing skipped`);
	}
}

function escape(str: string) {
	return str.replace(/[<&|]/g, (c) => '&#' + c.charCodeAt(0) + ';');
}
