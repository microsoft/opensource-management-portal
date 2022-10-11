// eslint-disable-next-line n/no-unpublished-import
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  transform: {
    '^.+\\.(js|ts|tsx)?$': 'ts-jest',
  },
};

export default config;
