.PHONY: dev build test typecheck web eval lint format install clean

install:
	npm install

dev:
	npx tsx src/entrypoints/cli.ts

build:
	npx tsup src/**/*.ts --format esm --dts

test:
	npx vitest run

test:watch:
	npx vitest

typecheck:
	npx tsc --noEmit

web:
	npx next dev app

web:build:
	npx next build app

eval:
	npx tsx src/entrypoints/eval.ts

lint:
	npx biome check src/ tests/

format:
	npx biome format --write src/ tests/

clean:
	rm -rf dist node_modules/.cache
