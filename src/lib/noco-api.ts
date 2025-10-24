import { NOCO_URL, NOCO_TOKEN, TABLE_SEND_QUEUE_ID, TABLE_SEND_LOGS_ID } from './config';

const headers = {
  "xc-token": NOCO_TOKEN,
  "Content-Type": "application/json",
  "accept": "application/json"
};

export async function nocoGET(url: string) {
  const r = await fetch(url, { headers: { "xc-token": NOCO_TOKEN } });
  if (!r.ok) throw new Error(`NocoDB GET ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function nocoPOST(url: string, body: any) {
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`NocoDB POST ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function nocoPATCH(url: string, body: any) {
  const r = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`NocoDB PATCH ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function nocoDELETE(url: string, body: any) {
  const r = await fetch(url, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`NocoDB DELETE ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function queueCreate(record: any) {
  const url = `${NOCO_URL}/api/v2/tables/${TABLE_SEND_QUEUE_ID}/records`;
  return await nocoPOST(url, record);
}

export async function queuePatch(id: string | number, patch: any) {
  const url = `${NOCO_URL}/api/v2/tables/${TABLE_SEND_QUEUE_ID}/records`;
  return await nocoPATCH(url, { Id: id, ...patch });
}

export async function queueDelete(id: string | number) {
  const url = `${NOCO_URL}/api/v2/tables/${TABLE_SEND_QUEUE_ID}/records`;
  return await nocoDELETE(url, { Id: id });
}

export async function queueGetOne(id: string | number) {
  const url = `${NOCO_URL}/api/v2/tables/${TABLE_SEND_QUEUE_ID}/records/${id}`;
  return await nocoGET(url);
}

export async function logsListByQueueId(queueId: string | number) {
  const where = encodeURIComponent(`(queue_id,eq,${queueId})`);
  const url = `${NOCO_URL}/api/v2/tables/${TABLE_SEND_LOGS_ID}/records?where=${where}&sort=-Id&limit=10000`;
  return await nocoGET(url);
}

export async function logsListForRun(runId: string) {
  const where = encodeURIComponent(`(run_id,eq,${runId})`);
  const url = `${NOCO_URL}/api/v2/tables/${TABLE_SEND_LOGS_ID}/records?where=${where}&sort=-Id&limit=10000`;
  return await nocoGET(url);
}
