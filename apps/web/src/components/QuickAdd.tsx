import { useState } from 'react';
import { savedMessage, useSaveTransaction } from '../lib/transactions';
import { useToast } from './Toast';
import { TransactionForm } from './TransactionForm';

/** Floating "+" button that opens a new transaction from any page. */
export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const save = useSaveTransaction();
  const toast = useToast();
  return (
    <>
      <button type="button" className="fab" aria-label="Add transaction" onClick={() => setOpen(true)}>
        +
      </button>
      {open && (
        <TransactionForm
          key={formKey}
          title="New transaction"
          allowAddAnother
          onClose={() => setOpen(false)}
          save={async (body, addAnother) => {
            toast.show(savedMessage(await save.mutateAsync({ body })));
            if (addAnother) setFormKey((k) => k + 1);
            else setOpen(false);
          }}
        />
      )}
    </>
  );
}
