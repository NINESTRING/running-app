import { updateRunHeartRate } from '../runs';

// 케이스별로 supabase client를 교체하기 위한 가변 홀더 (getter로 매 접근마다 재평가)
const mockHolder: { client: unknown } = { client: null };

jest.mock('../supabase', () => ({
  get supabase() {
    return mockHolder.client;
  },
}));

function clientWithUpdateResult(error: { message: string } | null) {
  const eq = jest.fn().mockResolvedValue({ error });
  const update = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ update });
  return { client: { from }, from, update, eq };
}

const HR = { samples: [[0, 120], [10, 131]] as [number, number][], avgHr: 126, maxHr: 133 };

describe('updateRunHeartRate', () => {
  afterEach(() => {
    mockHolder.client = null;
  });

  it('세 컬럼을 함께 update하고 성공 시 true', async () => {
    const { client, from, update, eq } = clientWithUpdateResult(null);
    mockHolder.client = client;
    await expect(updateRunHeartRate('run-1', HR)).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('runs');
    expect(update).toHaveBeenCalledWith({
      heart_rate_samples: HR.samples,
      avg_hr: 126,
      max_hr: 133,
    });
    expect(eq).toHaveBeenCalledWith('id', 'run-1');
  });

  it('DB 오류면 false', async () => {
    mockHolder.client = clientWithUpdateResult({ message: 'boom' }).client;
    await expect(updateRunHeartRate('run-1', HR)).resolves.toBe(false);
  });

  it('supabase 미설정이면 false', async () => {
    await expect(updateRunHeartRate('run-1', HR)).resolves.toBe(false);
  });
});
