import { deleteRun } from '../runs';

// 케이스별로 supabase client를 교체하기 위한 가변 홀더 (getter로 매 접근마다 재평가)
const mockHolder: { client: unknown } = { client: null };

jest.mock('../supabase', () => ({
  get supabase() {
    return mockHolder.client;
  },
}));

function clientWithDeleteResult(result: { error: { message: string } | null }) {
  const eq = jest.fn().mockResolvedValue(result);
  const del = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ delete: del });
  return { client: { from }, from, del, eq };
}

describe('deleteRun', () => {
  afterEach(() => {
    mockHolder.client = null;
  });

  it('runs 테이블에서 id로 삭제하고 true를 반환한다', async () => {
    const { client, from, del, eq } = clientWithDeleteResult({ error: null });
    mockHolder.client = client;

    await expect(deleteRun('run-1')).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('runs');
    expect(del).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('id', 'run-1');
  });

  it('에러 응답이면 false', async () => {
    const { client } = clientWithDeleteResult({ error: { message: 'boom' } });
    mockHolder.client = client;

    await expect(deleteRun('run-1')).resolves.toBe(false);
  });

  it('예외가 던져지면 false', async () => {
    mockHolder.client = {
      from: () => ({
        delete: () => ({ eq: () => Promise.reject(new Error('network')) }),
      }),
    };

    await expect(deleteRun('run-1')).resolves.toBe(false);
  });

  it('supabase 미설정이면 false', async () => {
    mockHolder.client = null;

    await expect(deleteRun('run-1')).resolves.toBe(false);
  });
});
