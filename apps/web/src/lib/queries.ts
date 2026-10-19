import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { Account, Category, Me, Recipient, Tag } from '@finance/shared';
import { api } from './api';

export const keys = {
  me: ['me'] as const,
  accounts: ['accounts'] as const,
  categories: ['categories'] as const,
  recipients: ['recipients'] as const,
  tags: ['tags'] as const,
  users: ['users'] as const,
};

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api<Me>('/auth/me'), retry: false, staleTime: 5 * 60_000 });
export const useAccounts = () => useQuery({ queryKey: keys.accounts, queryFn: () => api<Account[]>('/accounts') });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: () => api<Category[]>('/categories') });
export const useRecipients = () => useQuery({ queryKey: keys.recipients, queryFn: () => api<Recipient[]>('/recipients') });
export const useTags = () => useQuery({ queryKey: keys.tags, queryFn: () => api<Tag[]>('/tags') });

export interface UserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
}
export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: keys.users, queryFn: () => api<UserRow[]>('/users'), enabled });

/** A mutation that refreshes the given queries when it succeeds. */
export function useApiMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: QueryKey[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}
