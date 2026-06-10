import { type Did, isDid, isHandle } from '@atcute/lexicons/syntax';
import * as v from 'valibot';

import { type Source, sources } from './sources.ts';

const handleString = v.pipe(v.string(), v.check((value) => isHandle(value), 'must be a handle'));

const dateInt = v.pipe(
	v.number(),
	v.check((value) => !Number.isNaN(new Date(value).getTime()), 'invalid date'),
);

const didKeyed = <TValue extends v.GenericSchema>(value: TValue) => {
	return v.pipe(
		v.record(v.string(), value),
		v.check((input) => Object.keys(input).every(isDid), 'keys must be dids'),
		v.transform((input) => input as Record<Did, v.InferOutput<TValue>>),
	);
};

export const profile = v.object({
	handle: handleString,
	name: v.optional(v.string()),
});

export type Profile = v.InferOutput<typeof profile>;

// verified subjects are stored but never rendered, so their handle is kept as a plain string rather than
// asserted against handle syntax — a malformed handle on some obscure subject must not break the whole parse
export const subjectProfile = v.object({
	handle: v.string(),
	name: v.optional(v.string()),
});

export type SubjectProfile = v.InferOutput<typeof subjectProfile>;

export const verifiedEntry = v.object({
	at: dateInt,
	profile: subjectProfile,
});

export type VerifiedEntry = v.InferOutput<typeof verifiedEntry>;

const verifierStatus = v.picklist(['invalid', 'valid']);

const verifierSources = v.pipe(
	v.record(v.string(), verifierStatus),
	v.check((input) => Object.keys(input).every((key) => key in sources), 'unknown source'),
	v.transform((input) => input as Partial<Record<Source, v.InferOutput<typeof verifierStatus>>>),
);

export const verifierEntry = v.object({
	at: dateInt,
	profile: profile,
	sources: verifierSources,
	verified: didKeyed(verifiedEntry),
});

export type VerifierEntry = v.InferOutput<typeof verifierEntry>;

export const stateSchema = v.object({
	verifiers: didKeyed(verifierEntry),
});

export type State = v.InferOutput<typeof stateSchema>;
