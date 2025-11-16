import { Did, isDid, isHandle } from '@atcute/lexicons/syntax';
import * as v from '@badrap/valita';

const handleString = v.string().assert((input) => isHandle(input), `must be a handle`);

const dateInt = v.number().chain((value) => {
	const date = new Date(value);
	const ts = date.getTime();

	if (Number.isNaN(ts)) {
		return v.err(`invalid date`);
	}

	return v.ok(ts);
});

export const verificationEntry = v.object({
	at: dateInt,
	profile: v.object({
		name: v.string().optional(),
		handle: handleString,
	}),
	valid: v.boolean().optional(),
});

export type VerificationEntry = v.Infer<typeof verificationEntry>;

export const stateSchema = v.object({
	dids: v.record(verificationEntry).chain((input) => {
		for (const key in input) {
			if (isDid(key)) {
				continue;
			}

			return v.err({
				message: `must be a did key`,
				path: [key],
			});
		}

		return v.ok(input as Record<Did, VerificationEntry>);
	}),
});

export type State = v.Infer<typeof stateSchema>;
