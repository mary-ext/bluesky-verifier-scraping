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

// #region verifiers.json

const verifierStatus = v.picklist(['invalid', 'valid']);

const verifierSources = v.record(v.picklist(Object.keys(sources) as Source[]), verifierStatus);

export const verifierEntry = v.object({
	at: dateInt,
	profile: profile,
	sources: verifierSources,
});

export type VerifierEntry = v.InferOutput<typeof verifierEntry>;

export const verifiersFile = v.object({
	verifiers: didKeyed(verifierEntry),
});

export type VerifiersFile = v.InferOutput<typeof verifiersFile>;

// #endregion

// #region verified/<did>.json

// one file per verified account, keyed in `verifiedBy` by every trusted verifier that issued a verification
// for the subject — a subject can be verified by more than one verifier
export const verifiedSubject = v.object({
	profile: subjectProfile,
	verifiedBy: didKeyed(v.object({ at: dateInt })),
});

export type VerifiedSubject = v.InferOutput<typeof verifiedSubject>;

// #endregion
