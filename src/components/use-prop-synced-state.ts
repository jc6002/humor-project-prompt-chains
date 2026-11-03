'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';

export function usePropSyncedState<T>(initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initialValue);
  const [prevInitial, setPrevInitial] = useState<T>(initialValue);
  if (prevInitial !== initialValue) {
    setPrevInitial(initialValue);
    setValue(initialValue);
  }
  return [value, setValue];
}
