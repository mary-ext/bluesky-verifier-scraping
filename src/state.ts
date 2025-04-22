import * as z from '@zod/mini';

const didString = z.string().check(
	z.regex(/^(?=.{7,2048}$)did:([a-z]+):([a-zA-Z0-9._:%\-]*[a-zA-Z0-9._\-])$/),
);

const dateInt = z.number().check(
	z.refine((value) => {
		const date = new Date(value);
		const ts = date.getTime();

		return !Number.isNaN(ts);
	}),
);

export const serializedState = z.interface({
	jetstream: z.interface({
		'cursor?': z.number(),
	}),
	dids: z.record(
		didString,
		z.interface({
			at: dateInt,
			'profile?': z.interface({
				'name?': z.string(),
				'handle?': z.string(),
			}),
			'valid?': z.boolean(),
		}),
	),
});

export type SerializedState = z.infer<typeof serializedState>;

export type DidInfo = SerializedState['dids'][string];
