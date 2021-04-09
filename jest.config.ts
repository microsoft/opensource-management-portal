import type {Config} from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  transform: {
    '^.+\\.(js|ts|tsx)?$': 'ts-jest',
  }
};

export default config;
