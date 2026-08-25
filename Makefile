.PHONY: check check-fast check-affected container-check

check:
	npm run check

check-fast:
	npm run check:fast

check-affected:
	npm run check:affected

container-check:
	docker build --tag pegarr:harness .
