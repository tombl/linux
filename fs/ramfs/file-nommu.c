// SPDX-License-Identifier: GPL-2.0-or-later
/* file-nommu.c: no-MMU version of ramfs
 *
 * Copyright (C) 2005 Red Hat, Inc. All Rights Reserved.
 * Written by David Howells (dhowells@redhat.com)
 */

#include <linux/module.h>
#include <linux/fs.h>
#include <linux/mm.h>
#include <linux/pagemap.h>
#include <linux/highmem.h>
#include <linux/init.h>
#include <linux/string.h>
#include <linux/backing-dev.h>
#include <linux/ramfs.h>
#include <linux/folio_batch.h>
#include <linux/mman.h>
#include <linux/sched.h>
#include <linux/slab.h>
#include <linux/falloc.h>
#include <linux/overflow.h>
#include <linux/sched/signal.h>

#include <linux/uaccess.h>
#include "internal.h"

static int ramfs_nommu_setattr(struct mnt_idmap *, struct dentry *, struct iattr *);
static unsigned long ramfs_nommu_get_unmapped_area(struct file *file,
						   unsigned long addr,
						   unsigned long len,
						   unsigned long pgoff,
						   unsigned long flags);
static int ramfs_nommu_mmap_prepare(struct vm_area_desc *desc);
static long ramfs_nommu_fallocate(struct file *file, int mode, loff_t offset,
				  loff_t len);

static unsigned ramfs_mmap_capabilities(struct file *file)
{
	return NOMMU_MAP_DIRECT | NOMMU_MAP_COPY | NOMMU_MAP_READ |
		NOMMU_MAP_WRITE | NOMMU_MAP_EXEC;
}

const struct file_operations ramfs_file_operations = {
	.mmap_capabilities	= ramfs_mmap_capabilities,
	.mmap_prepare		= ramfs_nommu_mmap_prepare,
	.get_unmapped_area	= ramfs_nommu_get_unmapped_area,
	.read_iter		= generic_file_read_iter,
	.write_iter		= generic_file_write_iter,
	.fsync			= noop_fsync,
	.splice_read		= filemap_splice_read,
	.splice_write		= iter_file_splice_write,
	.llseek			= generic_file_llseek,
	.fallocate		= ramfs_nommu_fallocate,
};

const struct inode_operations ramfs_file_inode_operations = {
	.setattr		= ramfs_nommu_setattr,
	.getattr		= simple_getattr,
};

/*****************************************************************************/
/*
 * add a contiguous set of pages into a ramfs inode when it's truncated from
 * size 0 on the assumption that it's going to be used for an mmap of shared
 * memory
 */
int ramfs_nommu_expand_for_mapping(struct inode *inode, size_t newsize)
{
	unsigned long npages, xpages, loop;
	struct page *pages;
	unsigned order;
	void *data;
	int ret;
	gfp_t gfp = mapping_gfp_mask(inode->i_mapping);

	/*
	 * An empty file needs no pages, and get_order(0) is undefined.
	 * shmem_file_setup() expands to size 0 for memfd_create().
	 */
	if (!newsize)
		return 0;

	/* make various checks */
	order = get_order(newsize);
	if (unlikely(order > MAX_PAGE_ORDER))
		return -EFBIG;

	ret = inode_newsize_ok(inode, newsize);
	if (ret)
		return ret;

	/* allocate enough contiguous pages to be able to satisfy the
	 * request */
	pages = alloc_pages(gfp, order);
	if (!pages)
		return -ENOMEM;

	/* split the high-order page into an array of single pages */
	xpages = 1UL << order;
	npages = (newsize + PAGE_SIZE - 1) >> PAGE_SHIFT;

	split_page(pages, order);

	/* trim off any pages we don't actually require */
	for (loop = npages; loop < xpages; loop++)
		__free_page(pages + loop);

	/* clear the memory we allocated */
	data = page_address(pages);
	memset(data, 0, PAGE_SIZE * npages);

	/* attach all the pages to the inode's address space */
	for (loop = 0; loop < npages; loop++) {
		struct page *page = pages + loop;

		ret = add_to_page_cache_lru(page, inode->i_mapping, loop,
					gfp);
		if (ret < 0)
			goto add_error;

		/* prevent the page from being discarded on memory pressure */
		SetPageDirty(page);
		SetPageUptodate(page);

		unlock_page(page);
		put_page(page);
	}

	/* publish the size only once every page is attached */
	i_size_write(inode, newsize);
	return 0;

add_error:
	while (loop < npages)
		__free_page(pages + loop++);
	/* the file was empty, so drop the pages already attached */
	truncate_inode_pages(inode->i_mapping, 0);
	return ret;
}

/*****************************************************************************/
/*
 *
 */
static int ramfs_nommu_resize(struct inode *inode, loff_t newsize, loff_t size)
{
	int ret;

	/* assume a truncate from zero size is going to be for the purposes of
	 * shared mmap */
	if (size == 0) {
		if (unlikely(newsize >> 32))
			return -EFBIG;

		return ramfs_nommu_expand_for_mapping(inode, newsize);
	}

	/* check that a decrease in size doesn't cut off any shared mappings */
	if (newsize < size) {
		ret = nommu_shrink_inode_mappings(inode, size, newsize);
		if (ret < 0)
			return ret;
	}

	truncate_setsize(inode, newsize);
	return 0;
}

/*
 * Without an MMU, tmpfs is ramfs, so provide the part of tmpfs's fallocate
 * that callers reserving space before they write a file rely on
 * (systemd-journald's seqnum file and InnoDB's data files, for example).
 * Every page in the range is allocated, and mode 0 then grows the file to the
 * end of the range.
 *
 * The pages are allocated one at a time, not contiguously as when an empty
 * file is expanded for a shared mapping, so a file grown this way cannot be
 * mapped shared. FALLOC_FL_KEEP_SIZE is supported only within the file's
 * size: pages beyond it would be in the way of that expansion. Punching
 * holes and the other modes are not supported.
 */
static long ramfs_nommu_fallocate(struct file *file, int mode, loff_t offset,
				  loff_t len)
{
	struct inode *inode = file_inode(file);
	struct address_space *mapping = inode->i_mapping;
	pgoff_t index, last;
	loff_t end, size;
	int ret;

	if (mode & ~FALLOC_FL_KEEP_SIZE)
		return -EOPNOTSUPP;
	if (check_add_overflow(offset, len, &end))
		return -EFBIG;

	inode_lock(inode);
	size = i_size_read(inode);
	if (end > size) {
		ret = -EOPNOTSUPP;
		if (mode & FALLOC_FL_KEEP_SIZE)
			goto out;
		ret = inode_newsize_ok(inode, end);
		if (ret)
			goto out;
	}

	ret = file_modified(file);
	if (ret)
		goto out;

	last = (end - 1) >> PAGE_SHIFT;
	for (index = offset >> PAGE_SHIFT; index <= last; index++) {
		struct folio *folio;

		if (fatal_signal_pending(current)) {
			ret = -EINTR;
			break;
		}

		folio = __filemap_get_folio(mapping, index, FGP_LOCK | FGP_CREAT,
					    mapping_gfp_mask(mapping));
		if (IS_ERR(folio)) {
			ret = PTR_ERR(folio);
			break;
		}
		if (!folio_test_uptodate(folio)) {
			folio_zero_range(folio, 0, folio_size(folio));
			folio_mark_uptodate(folio);
		}
		/* prevent the page from being discarded on memory pressure */
		folio_mark_dirty(folio);
		folio_unlock(folio);
		folio_put(folio);
		cond_resched();
	}

	if (ret) {
		/* drop the pages allocated beyond the file's size */
		if (end > size)
			truncate_pagecache(inode, size);
		goto out;
	}

	if (end > size)
		i_size_write(inode, end);
out:
	inode_unlock(inode);
	return ret;
}

/*****************************************************************************/
/*
 * handle a change of attributes
 * - we're specifically interested in a change of size
 */
static int ramfs_nommu_setattr(struct mnt_idmap *idmap,
			       struct dentry *dentry, struct iattr *ia)
{
	struct inode *inode = d_inode(dentry);
	unsigned int old_ia_valid = ia->ia_valid;
	int ret = 0;

	/* POSIX UID/GID verification for setting inode attributes */
	ret = setattr_prepare(&nop_mnt_idmap, dentry, ia);
	if (ret)
		return ret;

	/* pick out size-changing events */
	if (ia->ia_valid & ATTR_SIZE) {
		loff_t size = inode->i_size;

		if (ia->ia_size != size) {
			ret = ramfs_nommu_resize(inode, ia->ia_size, size);
			if (ret < 0 || ia->ia_valid == ATTR_SIZE)
				goto out;
		} else {
			/* we skipped the truncate but must still update
			 * timestamps
			 */
			ia->ia_valid |= ATTR_MTIME|ATTR_CTIME;
		}
	}

	setattr_copy(&nop_mnt_idmap, inode, ia);
 out:
	ia->ia_valid = old_ia_valid;
	return ret;
}

/*****************************************************************************/
/*
 * try to determine where a shared mapping can be made
 * - we require that:
 *   - the pages to be mapped must exist
 *   - the pages be physically contiguous in sequence
 */
static unsigned long ramfs_nommu_get_unmapped_area(struct file *file,
					    unsigned long addr, unsigned long len,
					    unsigned long pgoff, unsigned long flags)
{
	unsigned long maxpages, lpages, nr_folios, loop, ret, nr_pages, pfn;
	struct inode *inode = file_inode(file);
	struct folio_batch fbatch;
	loff_t isize;

	/* the mapping mustn't extend beyond the EOF */
	lpages = (len + PAGE_SIZE - 1) >> PAGE_SHIFT;
	isize = i_size_read(inode);

	ret = -ENOSYS;
	maxpages = (isize + PAGE_SIZE - 1) >> PAGE_SHIFT;
	if (pgoff >= maxpages)
		goto out;

	if (maxpages - pgoff < lpages)
		goto out;

	/* gang-find the pages */
	folio_batch_init(&fbatch);
	nr_pages = 0;
repeat:
	nr_folios = filemap_get_folios_contig(inode->i_mapping, &pgoff,
			ULONG_MAX, &fbatch);
	if (!nr_folios) {
		ret = -ENOSYS;
		return ret;
	}

	if (ret == -ENOSYS) {
		ret = (unsigned long) folio_address(fbatch.folios[0]);
		pfn = folio_pfn(fbatch.folios[0]);
	}
	/* check the pages for physical adjacency */
	for (loop = 0; loop < nr_folios; loop++) {
		if (pfn + nr_pages != folio_pfn(fbatch.folios[loop])) {
			ret = -ENOSYS;
			goto out_free; /* leave if not physical adjacent */
		}
		nr_pages += folio_nr_pages(fbatch.folios[loop]);
		if (nr_pages >= lpages)
			goto out_free; /* successfully found desired pages*/
	}

	if (nr_pages < lpages) {
		folio_batch_release(&fbatch);
		goto repeat; /* loop if pages are missing */
	}
	/* okay - all conditions fulfilled */

out_free:
	folio_batch_release(&fbatch);
out:
	return ret;
}

/*****************************************************************************/
/*
 * set up a mapping for shared memory segments
 */
static int ramfs_nommu_mmap_prepare(struct vm_area_desc *desc)
{
	if (!is_nommu_shared_vma_flags(&desc->vma_flags))
		return -ENOSYS;

	file_accessed(desc->file);
	desc->vm_ops = &generic_file_vm_ops;
	return 0;
}
