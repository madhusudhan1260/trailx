/** Core logic is pure TypeScript, so tests run in plain Node — no device or simulator involved. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs', esModuleInterop: true, target: 'es2020', strict: true, baseUrl: '.', paths: { '@/*': ['src/*'] }, isolatedModules: true }, diagnostics: false }],
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
};
