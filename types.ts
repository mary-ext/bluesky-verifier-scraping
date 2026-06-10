import { type Did, type Handle, isDid, isHandle } from '@atcute/lexicons/syntax';
import * as v from 'valibot';

import { type Source, sources } from './sources.ts';

const handleString = v.custom<Handle>(isHandle, 'must be a handle');

const didString = v.custom<Did>(isDid, 'must be a did');

const dateInt = v.pipe(
	v.number(),
	v.check((value) => !Number.isNaN(new Date(value).getTime()), 'invalid date'),
);

const didKeyed = <TValue extends v.GenericSchema>(value: TValue) => v.record(didString, value);

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

const verifierSources = v.record(v.picklist(Object.keys(sources) as Source[]), verifierStatus);

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
