import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    supabaseKey: 'anon-key',
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'user-jwt' } } }) },
  },
}));
vi.mock('../../lib/api', () => ({ api: { post: vi.fn() } }));

import { api } from '../../lib/api';
import { getUploadUrl, mimeForFile, submitDocumentRecord, uploadToStorage } from '../../lib/data/documents';

class FakeXhr {
  static last = null;
  constructor() {
    FakeXhr.last = this;
    this.headers = {};
    this.upload = {};
    this.status = 0;
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k, v) {
    this.headers[k] = v;
  }
  send(body) {
    this.body = body;
  }
}

describe('documents transport', () => {
  const realXhr = globalThis.XMLHttpRequest;
  beforeEach(() => {
    globalThis.XMLHttpRequest = FakeXhr;
    FakeXhr.last = null;
    vi.clearAllMocks();
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = realXhr;
  });

  it('step 1 and 3 go through api.post with base-relative contract paths', async () => {
    api.post.mockResolvedValue({ ok: true });
    const file = new File(['abc'], 'DDR_12.pdf', { type: 'application/pdf' });
    await getUploadUrl(file);
    expect(api.post).toHaveBeenCalledWith('/documents/upload-url', { filename: 'DDR_12.pdf', size_bytes: 3, mime_type: 'application/pdf' });
    const payload = { storage_path: 'incoming/u/DDR_12.pdf', filename: 'DDR_12.pdf', well_id: null, wellbore_id: null, doc_type: null, provenance: 'direct' };
    await submitDocumentRecord(payload);
    expect(api.post).toHaveBeenLastCalledWith('/documents', payload);
  });

  it('falls back to a mime type from the extension (LAS has none)', () => {
    expect(mimeForFile({ name: 'log.LAS', type: '' })).toBe('application/octet-stream');
    expect(mimeForFile({ name: 'a.tiff', type: '' })).toBe('image/tiff');
    expect(mimeForFile({ name: 'a.pdf', type: 'application/pdf' })).toBe('application/pdf');
  });

  it('uploads straight to the signed storage URL with XHR and reports real byte progress', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('fetch must not be used')));
    const onProgress = vi.fn();
    const file = new File([new Uint8Array(200)], 'big.pdf', { type: 'application/pdf' });
    const signed = 'https://proj.supabase.co/storage/v1/object/upload/sign/documents/incoming/u/big.pdf?token=tok';
    const promise = uploadToStorage('incoming/u/big.pdf', 'tok', file, onProgress, signed);
    await vi.waitFor(() => expect(FakeXhr.last?.body).toBeDefined());
    const xhr = FakeXhr.last;

    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe(signed);
    expect(xhr.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer user-jwt', 'x-upsert': 'false' });
    expect(xhr.body).toBeInstanceOf(FormData);
    expect(xhr.body.get('')).toBeInstanceOf(File);

    xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 200 });
    xhr.upload.onprogress({ lengthComputable: true, loaded: 150, total: 200 });
    xhr.upload.onprogress({ lengthComputable: false, loaded: 1, total: 0 }); // ignored
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([25, 75]);

    xhr.status = 200;
    xhr.onload();
    await expect(promise).resolves.toEqual({ path: 'incoming/u/big.pdf' });
    expect(onProgress).toHaveBeenLastCalledWith(100);
    expect(fetchSpy).not.toHaveBeenCalled(); // no fetch, no Vercel function in the byte path
    fetchSpy.mockRestore();
  });

  it('builds the signed URL from the token when signed_url is not given', async () => {
    const promise = uploadToStorage('incoming/u/a b.pdf', 'to/k', new File(['x'], 'a b.pdf'));
    await vi.waitFor(() => expect(FakeXhr.last?.body).toBeDefined());
    expect(FakeXhr.last.url).toMatch(/\/storage\/v1\/object\/upload\/sign\/documents\/incoming\/u\/a%20b\.pdf\?token=to%2Fk$/);
    FakeXhr.last.status = 200;
    FakeXhr.last.onload();
    await promise;
  });

  it('rejects with the server message on HTTP errors and on network errors', async () => {
    const p1 = uploadToStorage('incoming/u/a.pdf', 't', new File(['x'], 'a.pdf'), null, 'https://x/y?token=t');
    await vi.waitFor(() => expect(FakeXhr.last?.body).toBeDefined());
    FakeXhr.last.status = 413;
    FakeXhr.last.responseText = JSON.stringify({ message: 'The object exceeded the maximum allowed size' });
    FakeXhr.last.onload();
    await expect(p1).rejects.toThrow(/maximum allowed size/);

    FakeXhr.last = null;
    const p2 = uploadToStorage('incoming/u/b.pdf', 't', new File(['x'], 'b.pdf'), null, 'https://x/y?token=t');
    await vi.waitFor(() => expect(FakeXhr.last?.body).toBeDefined());
    FakeXhr.last.onerror();
    await expect(p2).rejects.toThrow(/network error/i);
  });
});
