import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import dispatch, { ROUTES, resolve } from '../_dispatch.js';
import adminUsersId from '../_routes/admin/users/[id].js';
import adminUsersInvite from '../_routes/admin/users/invite.js';
import wellsRisk from '../_routes/wells/[wellboreId]/risk.js';

const apiDir = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../api'); // the only directory Vercel turns into functions

function functionFiles(dir, base = '') {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith('_')) return []; // _lib, _routes, _dispatch.js, __tests__: not deployed as functions
    const rel = join(base, name);
    return statSync(join(dir, name)).isDirectory() ? functionFiles(join(dir, name), rel) : name.endsWith('.js') ? [rel] : [];
  });
}

describe('one serverless function for every route', () => {
  it('deploys exactly one function (the Hobby plan allows 12; there are 17 routes)', () => {
    expect(functionFiles(apiDir)).toEqual(['dispatch.js']);
    expect(ROUTES).toHaveLength(17);
  });

  it('resolves every contract path, with its params', () => {
    expect(resolve(['wells', 'abc', 'risk'])).toMatchObject({ handler: wellsRisk, params: { wellboreId: 'abc' } });
    expect(resolve(['health']).params).toEqual({});
    expect(resolve(['documents', 'd1', 'reprocess']).params).toEqual({ documentId: 'd1' });
    expect(resolve(['wells', 'a%20b', 'correlation']).params).toEqual({ wellboreId: 'a b' });
  });

  it('a literal segment wins over a :param one, and unknown paths do not match', () => {
    expect(resolve(['admin', 'users', 'invite']).handler).toBe(adminUsersInvite);
    expect(resolve(['admin', 'users', 'some-id']).handler).toBe(adminUsersId);
    expect(resolve(['nope'])).toBeNull();
    expect(resolve(['wells', 'abc'])).toBeNull();
    expect(resolve(['stream', 'start', 'extra'])).toBeNull();
  });

  it('answers 404 in the contract error shape for an unknown path and sets req.query for a known one', async () => {
    const sent = {};
    const res = { status: (c) => ((sent.status = c), res), json: (b) => ((sent.body = b), res) };
    await dispatch({ url: '/api/nope', method: 'GET', headers: {} }, res);
    expect(sent.status).toBe(404);
    expect(sent.body.error.code).toBe('NWIS_NOT_FOUND');

    const req = { url: '/api/health?x=1', method: 'POST', headers: {} };
    const res2 = { status: (c) => ((sent.status2 = c), res2), json: () => res2, setHeader() {}, end() {} };
    await dispatch(req, res2); // health only allows GET: it answers 405 itself, after the dispatcher set the query
    expect(req.query).toEqual({ x: '1' });
    expect(sent.status2).toBe(405);
  });
});
