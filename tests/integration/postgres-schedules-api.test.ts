import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { user, savedConnection, backupSchedule } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { auth } from "@/lib/auth";
import crypto from "node:crypto";
import * as pgConnectionModule from "@/lib/postgres-connection";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

import { GET as getSchedules, POST as createSchedule } from "@/app/api/postgres/schedules/route";
import {
  GET as getScheduleById,
  PATCH as patchScheduleById,
  DELETE as deleteScheduleById,
} from "@/app/api/postgres/schedules/[id]/route";
import { GET as getScheduleRuns } from "@/app/api/postgres/schedules/[id]/runs/route";

describe("PostgreSQL Schedules API Endpoints", () => {
  let testUserId: string;
  let testConnectionId: string;

  beforeEach(async () => {
    testUserId = crypto.randomUUID();
    await db.insert(user).values({
      id: testUserId,
      name: "API Schedule Test User",
      email: `${testUserId}@example.com`,
    });

    testConnectionId = crypto.randomUUID();
    await db.insert(savedConnection).values({
      id: testConnectionId,
      userId: testUserId,
      host: "pg.api.internal",
      port: 5432,
      username: "pgadmin",
      database: "store_pg",
      engine: "postgres",
      encryptedConnectionString: encrypt(
        "postgresql://pgadmin:pass@pg.api.internal:5432/store_pg"
      ),
    });

    // Mock auth session
    vi.spyOn(auth.api, "getSession").mockResolvedValue({
      user: {
        id: testUserId,
        name: "API Schedule Test User",
        email: `${testUserId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: crypto.randomUUID(),
        userId: testUserId,
        token: "test-token",
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

    // Mock listPostgresUserDatabases so network calls aren't required during API testing
    vi.spyOn(pgConnectionModule, "listPostgresUserDatabases").mockResolvedValue({
      databases: ["store_pg", "analytics_pg"],
      version: "PostgreSQL 16.0",
    });
  });

  it("POST /api/postgres/schedules creates a new schedule with validation", async () => {
    const req = new Request("http://localhost/api/postgres/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        savedConnectionId: testConnectionId,
        databaseName: "store_pg",
        cronExpression: "0 3 * * *",
        timezone: "America/New_York",
        retentionCount: 14,
      }),
    });

    const res = await createSchedule(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.schedule).toBeDefined();
    expect(data.schedule.databaseName).toBe("store_pg");
    expect(data.schedule.cronExpression).toBe("0 3 * * *");
    expect(data.schedule.timezone).toBe("America/New_York");
    expect(data.schedule.retentionCount).toBe(14);
    expect(data.schedule.enabled).toBe(true);
  });

  it("POST /api/postgres/schedules rejects nonexistent target database", async () => {
    const req = new Request("http://localhost/api/postgres/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        savedConnectionId: testConnectionId,
        databaseName: "nonexistent_db",
        cronExpression: "0 3 * * *",
        timezone: "UTC",
        retentionCount: 7,
      }),
    });

    const res = await createSchedule(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("does not exist on the target PostgreSQL server");
  });

  it("POST /api/postgres/schedules rejects duplicate schedule for same connection and db", async () => {
    // Insert an existing schedule
    await db.insert(backupSchedule).values({
      id: crypto.randomUUID(),
      userId: testUserId,
      savedConnectionId: testConnectionId,
      databaseName: "store_pg",
      cronExpression: "0 0 * * *",
      timezone: "UTC",
    });

    const req = new Request("http://localhost/api/postgres/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        savedConnectionId: testConnectionId,
        databaseName: "store_pg",
        cronExpression: "0 1 * * *",
        timezone: "UTC",
        retentionCount: 7,
      }),
    });

    const res = await createSchedule(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already exists");
  });

  it("GET /api/postgres/schedules returns schedules joined with connection info", async () => {
    const scheduleId = crypto.randomUUID();
    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId: testUserId,
      savedConnectionId: testConnectionId,
      databaseName: "store_pg",
      cronExpression: "0 2 * * *",
      timezone: "UTC",
      retentionCount: 7,
      enabled: true,
    });

    const res = await getSchedules();
    expect(res.status).toBe(200);
    const data = await res.json();
    const schedules = data.schedules as Array<{
      id: string;
      connectionHost: string;
      connectionPort: number;
      connectionEngine: string;
    }>;
    const found = schedules.find((s) => s.id === scheduleId);
    expect(found).toBeDefined();
    expect(found!.connectionHost).toBe("pg.api.internal");
    expect(found!.connectionPort).toBe(5432);
    expect(found!.connectionEngine).toBe("postgres");
  });

  it("GET, PATCH, and DELETE /api/postgres/schedules/[id] lifecycle", async () => {
    const scheduleId = crypto.randomUUID();
    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId: testUserId,
      savedConnectionId: testConnectionId,
      databaseName: "store_pg",
      cronExpression: "0 2 * * *",
      timezone: "UTC",
      retentionCount: 7,
      enabled: true,
    });

    // 1. GET by id
    const getRes = await getScheduleById(
      new Request(`http://localhost/api/postgres/schedules/${scheduleId}`),
      { params: Promise.resolve({ id: scheduleId }) }
    );
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.schedule.id).toBe(scheduleId);
    expect(Array.isArray(getData.runs)).toBe(true);

    // 2. PATCH
    const patchReq = new Request(`http://localhost/api/postgres/schedules/${scheduleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cronExpression: "0 5 * * *",
        retentionCount: 21,
        enabled: false,
      }),
    });
    const patchRes = await patchScheduleById(patchReq, {
      params: Promise.resolve({ id: scheduleId }),
    });
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.schedule.cronExpression).toBe("0 5 * * *");
    expect(patchData.schedule.retentionCount).toBe(21);
    expect(patchData.schedule.enabled).toBe(false);

    // 3. GET runs
    const runsRes = await getScheduleRuns(
      new Request(`http://localhost/api/postgres/schedules/${scheduleId}/runs`),
      { params: Promise.resolve({ id: scheduleId }) }
    );
    expect(runsRes.status).toBe(200);
    const runsData = await runsRes.json();
    expect(Array.isArray(runsData.runs)).toBe(true);

    // 4. DELETE
    const deleteRes = await deleteScheduleById(
      new Request(`http://localhost/api/postgres/schedules/${scheduleId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: scheduleId }) }
    );
    expect(deleteRes.status).toBe(200);

    // Confirm deleted
    const verifyRes = await getScheduleById(
      new Request(`http://localhost/api/postgres/schedules/${scheduleId}`),
      { params: Promise.resolve({ id: scheduleId }) }
    );
    expect(verifyRes.status).toBe(404);
  });
});
