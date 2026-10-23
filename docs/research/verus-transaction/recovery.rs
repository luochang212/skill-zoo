// Model only: slots represent the journal's affected files in iteration order.
// None means absent; Some(token) identifies file contents. No filesystem IO is proved.
use vstd::prelude::*;

verus! {

fn apply_prefix(disk: &mut Vec<Option<u64>>, target: &Vec<Option<u64>>, limit: usize)
    requires
        old(disk).len() == target.len(),
        limit <= target.len(),
    ensures
        final(disk).len() == old(disk).len(),
        forall|j: int| 0 <= j < target.len() ==>
            final(disk)[j] == if j < limit { target[j] } else { old(disk)[j] },
{
    let ghost initial = disk@;
    let mut i: usize = 0;
    while i < limit
        invariant
            disk.len() == target.len(),
            initial.len() == target.len(),
            i <= limit <= target.len(),
            forall|j: int| 0 <= j < target.len() ==>
                disk[j] == if j < i { target[j] } else { initial[j] },
        decreases limit - i,
    {
        disk.set(i, target[i]);
        i += 1;
    }
}

fn recover_prefix(
    disk: &mut Vec<Option<u64>>,
    before: &Vec<Option<u64>>,
    after: &Vec<Option<u64>>,
    committed: bool,
    limit: usize,
) -> (keep_journal: bool)
    requires
        old(disk).len() == before.len(),
        before.len() == after.len(),
        limit <= before.len(),
    ensures
        final(disk).len() == old(disk).len(),
        keep_journal == (limit < before.len()),
        forall|j: int| 0 <= j < before.len() ==>
            final(disk)[j] == if j < limit {
                if committed { after[j] } else { before[j] }
            } else { old(disk)[j] },
{
    if committed {
        apply_prefix(disk, after, limit);
    } else {
        apply_prefix(disk, before, limit);
    }
    limit < before.len()
}

fn interrupted_then_retry(
    disk: &mut Vec<Option<u64>>,
    before: &Vec<Option<u64>>,
    after: &Vec<Option<u64>>,
    committed: bool,
    interrupted_at: usize,
) -> (keep_journal: bool)
    requires
        old(disk).len() == before.len(),
        before.len() == after.len(),
        interrupted_at <= before.len(),
    ensures
        !keep_journal,
        final(disk).len() == before.len(),
        forall|j: int| 0 <= j < before.len() ==>
            final(disk)[j] == if committed { after[j] } else { before[j] },
{
    let keep = recover_prefix(disk, before, after, committed, interrupted_at);
    if keep {
        recover_prefix(disk, before, after, committed, before.len())
    } else {
        false
    }
}

fn partial_recovery_is_idempotent(
    disk: &mut Vec<Option<u64>>,
    before: &Vec<Option<u64>>,
    after: &Vec<Option<u64>>,
    committed: bool,
    limit: usize,
) -> (keep_journal: bool)
    requires
        old(disk).len() == before.len(),
        before.len() == after.len(),
        limit <= before.len(),
    ensures
        keep_journal == (limit < before.len()),
        final(disk).len() == before.len(),
        forall|j: int| 0 <= j < before.len() ==>
            final(disk)[j] == if j < limit {
                if committed { after[j] } else { before[j] }
            } else { old(disk)[j] },
{
    recover_prefix(disk, before, after, committed, limit);
    let ghost partially_recovered = disk@;
    let keep_again = recover_prefix(disk, before, after, committed, limit);
    assert(disk@ =~= partially_recovered);
    keep_again
}

fn completed_recovery_is_idempotent(
    disk: &mut Vec<Option<u64>>,
    before: &Vec<Option<u64>>,
    after: &Vec<Option<u64>>,
    committed: bool,
)
    requires
        old(disk).len() == before.len(),
        before.len() == after.len(),
    ensures
        final(disk).len() == before.len(),
        forall|j: int| 0 <= j < before.len() ==>
            final(disk)[j] == if committed { after[j] } else { before[j] },
{
    recover_prefix(disk, before, after, committed, before.len());
    let ghost recovered = disk@;
    recover_prefix(disk, before, after, committed, before.len());
    assert(disk@ =~= recovered);
}

fn main() {}

} // verus!
