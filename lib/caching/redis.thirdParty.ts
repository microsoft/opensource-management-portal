//
// MIT License
//
// Copyright (c) 2022-2023, Redis, inc.
//

// https://github.com/redis/node-redis/blob/master/packages/client/lib/RESP/decoder.ts

// implemented for node-redis from the spec:
// https://github.com/redis/redis-specifications/blob/master/protocol/RESP3.md

// v5 of the library does not export the RESP types.

export const RESP_TYPES = {
  NULL: 95, // _
  BOOLEAN: 35, // #
  NUMBER: 58, // :
  BIG_NUMBER: 40, // (
  DOUBLE: 44, // ,
  SIMPLE_STRING: 43, // +
  BLOB_STRING: 36, // $
  VERBATIM_STRING: 61, // =
  SIMPLE_ERROR: 45, // -
  BLOB_ERROR: 33, // !
  ARRAY: 42, // *
  SET: 126, // ~
  MAP: 37, // %
  PUSH: 62, // >
} as const;
