import { deleteRun } from '../runs';

// 케이스별로 supabase client를 교체하기 위한 가변 홀더 (getter로 매 접근마다 재평가)
const mockHolder: { client: unknown } = { client: null };

jest.mock('../supabase', () => ({
  get supabase() {
    return mockHolder.client;
  },
}));

function clientWithDeleteResult(result: {
  data: { id: string }[] | null;
  error: { message: string } | null;
}) {
  const select = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ select });
  const del = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ delete: del });
  return { client: { from }, from, del, eq, select };
}

describe('deleteRun', () => {
  afterEach(() => {
    mockHolder.client = null;
  });

  it('runs 테이블에서 id로 삭제하고 삭제된 행을 확인해 ok를 반환한다', async () => {
    const { client, from, del, eq, select } = clientWithDeleteResult({
      data: [{ id: 'run-1' }],
      error: null,
    });
    mockHolder.client = client;

    await expect(deleteRun('run-1')).resolves.toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('runs');
    expect(del).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('id', 'run-1');
    expect(select).toHaveBeenCalledWith('id');
  });

  it('에러 응답이면 에러 메시지와 함께 실패', async () => {
    const { client } = clientWithDeleteResult({ data: null, error: { message: 'boom' } });
    mockHolder.client = client;

    await expect(deleteRun('run-1')).resolves.toEqual({ ok: false, error: 'boom' });
  });

  it('삭제된 행이 0개면 실패 (RLS 필터·이미 없는 기록을 성공으로 오판하지 않음)', async () => {
    const { client } = clientWithDeleteResult({ data: [], error: null });
    mockHolder.client = client;

    const result = await deleteRun('run-1');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('예외가 던져지면 실패', async () => {
    mockHolder.client = {
      from: () => ({
        delete: () => ({
          eq: () => ({ select: () => Promise.reject(new Error('network')) }),
        }),
      }),
    };

    await expect(deleteRun('run-1')).resolves.toEqual({ ok: false, error: 'network' });
  });

  it('supabase 미설정이면 실패', async () => {
    mockHolder.client = null;

    const result = await deleteRun('run-1');
    expect(result.ok).toBe(false);
  });
});
