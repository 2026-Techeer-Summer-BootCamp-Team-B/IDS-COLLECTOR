.PHONY: network up down

network:
	docker network inspect siem-net >/dev/null 2>&1 || docker network create siem-net

up: network
	test -f servers/datastore/postgres/.env || cp servers/datastore/postgres/.env.example servers/datastore/postgres/.env
	test -f servers/datastore/redis/.env || cp servers/datastore/redis/.env.example servers/datastore/redis/.env
	docker compose -f servers/kafka/docker-compose.yml up -d
	docker compose -f servers/datastore/postgres/docker-compose.yml up -d
	docker compose -f servers/datastore/redis/docker-compose.yml up -d
	docker compose -f servers/datastore/opensearch/docker-compose.yml up -d
	docker compose -f servers/datastore/clickhouse/docker-compose.yml up -d
	docker compose -f servers/otel/docker-compose.yml up -d
	docker compose -f servers/proxy/docker-compose.yml up -d
	docker compose -f servers/docker-compose.yml up -d --build

down:
	docker compose -f servers/docker-compose.yml down
	docker compose -f servers/proxy/docker-compose.yml down
	docker compose -f servers/otel/docker-compose.yml down
	docker compose -f servers/datastore/clickhouse/docker-compose.yml down
	docker compose -f servers/datastore/opensearch/docker-compose.yml down
	docker compose -f servers/datastore/redis/docker-compose.yml down
	docker compose -f servers/datastore/postgres/docker-compose.yml down
	docker compose -f servers/kafka/docker-compose.yml down
