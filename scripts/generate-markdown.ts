// deno-lint-ignore-file no-explicit-any

const STATE_FILE = Deno.env.get('STATE_FILE');
const RESULT_FILE = Deno.env.get('RESULT_FILE');

if (!STATE_FILE || !RESULT_FILE) {
	throw new Error('STATE_FILE and RESULT_FILE environment variables are required');
}

let json: any;

{
	const raw = Deno.readTextFileSync(STATE_FILE);
	json = JSON.parse(raw);
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
	const accounts = Object.entries(json.dids)
		.map(([did, acc]: any): Account => ({ ...acc, did }))
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
		const source = Deno.readTextFileSync(RESULT_FILE);

		if (TABLE_RE.exec(source)?.[0] === table) {
			shouldWrite = false;
		}
		// deno-lint-ignore no-empty
	} catch {}

	// Write the markdown file
	if (shouldWrite) {
		const final = template.replace('{{time}}', new Date().toISOString()).replace(TABLE_RE, table);

		Deno.writeTextFileSync(RESULT_FILE, final);
		console.log(`wrote to readme`);
	} else {
		console.log(`writing skipped`);
	}
}

interface Account {
	did: string;
	at: number;
	profile: {
		name?: string;
		handle: string;
	};
	valid: boolean;
}

function escape(str: string) {
	return str.replace(/[<&|]/g, (c) => '&#' + c.charCodeAt(0) + ';');
}
