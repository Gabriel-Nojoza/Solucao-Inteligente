import Redis from "ioredis"

let _client: Redis | null = null

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL || "redis://localhost:6379"
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
    enableOfflineQueue: false,
  })
  client.on("error", (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err ?? "desconhecido")
    console.warn("[redis] erro:", msg)
  })
  return client
}

function getRedis(): Redis {
  if (!_client) {
    _client = createRedisClient()
  }
  return _client
}

export async function redisGet(key: string): Promise<string | null> {
  try {
    return await getRedis().get(key)
  } catch {
    return null
  }
}

export async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(key, value, "EX", ttlSeconds)
  } catch {
    // ignorar falha no Redis — in-memory ainda funciona
  }
}
