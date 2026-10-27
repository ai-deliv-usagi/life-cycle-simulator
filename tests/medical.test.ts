import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { choiceCost, fireEvent } from '../src/engine/events';
import type { EventDef } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

describe('高額療養費', () => {
  it('年収370万円未満か引退後は、医療の出来事1回の自己負担が10万円まで', () => {
    const young = setAge(makeState(), 25); // 新卒の年収は370万円未満
    fireEvent(young, byId('hospital'), flatRng);
    expect(young.assets.cash).toBe(-100_000);
    const retired = setAge(makeState(), 70);
    retired.character.retired = true;
    fireEvent(retired, byId('hospital'), flatRng);
    expect(retired.assets.cash).toBe(-100_000);
  });

  it('収入が多い人は今までどおり。医療でない出来事(介護)は上限なし', () => {
    const rich = setAge(makeState({ job: 'engineer', initialCash: 1_000_000 }), 45);
    rich.stats.skill = 100;
    rich.policy.work = 'grind';
    fireEvent(rich, byId('hospital'), flatRng);
    expect(rich.assets.cash).toBe(700_000);
    const old = setAge(makeState({ initialCash: 10_000_000 }), 80);
    old.character.retired = true;
    expect(choiceCost(byId('care_needed'), byId('care_needed').choices![0]!, old).spend).toBe(5_000_000);
    expect(choiceCost(byId('serious_illness'), byId('serious_illness').choices![0]!, old)).toMatchObject({ spend: 100_000 });
  });
});
