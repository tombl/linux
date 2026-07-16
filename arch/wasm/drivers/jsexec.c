// SPDX-License-Identifier: GPL-2.0
/*
 * jsexec.c - JavaScript execution device for WebAssembly Linux
 *
 * Provides /dev/jsexec: write JS code, then read to execute it
 * in the host JavaScript environment and get the result.
 *
 * Usage:
 *   echo '1 + 2' > /dev/jsexec
 *   cat /dev/jsexec        # -> "3"
 *
 *   echo 'Math.floor(Math.random() * 100)' > /dev/jsexec
 *   cat /dev/jsexec
 *
 *   echo 'JSON.stringify({hello: "world"})' > /dev/jsexec
 *   cat /dev/jsexec
 */

#define pr_fmt(fmt) "jsexec: " fmt

#include <asm/wasm_imports.h>
#include <linux/fs.h>
#include <linux/miscdevice.h>
#include <linux/module.h>
#include <linux/mutex.h>
#include <linux/slab.h>
#include <linux/uaccess.h>

#define JSEXEC_MAX_CODE_LEN   65536
#define JSEXEC_MAX_RESULT_LEN 65536

/*
 * Global state — simple and sufficient for this single-purpose device.
 * The mutex serialises write/execute/read so that the result always
 * corresponds to the most recently written code.
 */
static DEFINE_MUTEX(jsexec_lock);

static char  *jsexec_code;
static size_t jsexec_code_len;

static char  *jsexec_result;
static size_t jsexec_result_len;
static size_t jsexec_result_pos;   /* read offset within result          */
static bool   jsexec_has_result;   /* is the current result buffer valid? */

static ssize_t jsexec_write(struct file *file, const char __user *buf,
			    size_t count, loff_t *ppos)
{
	if (count > JSEXEC_MAX_CODE_LEN)
		return -ENOMEM;

	mutex_lock(&jsexec_lock);

	if (copy_from_user(jsexec_code, buf, count)) {
		mutex_unlock(&jsexec_lock);
		return -EFAULT;
	}

	jsexec_code_len   = count;
	jsexec_has_result = false; /* invalidate stale result */

	mutex_unlock(&jsexec_lock);
	return count;
}

static ssize_t jsexec_read(struct file *file, char __user *buf,
			   size_t count, loff_t *ppos)
{
	ssize_t ret;
	size_t remaining;

	mutex_lock(&jsexec_lock);

	/* Execute the code on first read after a write. */
	if (!jsexec_has_result) {
		if (jsexec_code_len == 0) {
			ret = 0;
			goto out;
		}

		jsexec_result_len = wasm_jsexec_run(jsexec_code,
						    jsexec_code_len,
						    jsexec_result,
						    JSEXEC_MAX_RESULT_LEN);
		jsexec_result_pos = 0;
		jsexec_has_result = true;
	}

	remaining = jsexec_result_len - jsexec_result_pos;
	if (remaining == 0) {
		/* All consumed — signal EOF and allow re-execution. */
		jsexec_has_result = false;
		ret = 0;
		goto out;
	}

	if (count > remaining)
		count = remaining;

	if (copy_to_user(buf, jsexec_result + jsexec_result_pos, count)) {
		ret = -EFAULT;
		goto out;
	}

	jsexec_result_pos += count;
	ret = count;

out:
	mutex_unlock(&jsexec_lock);
	return ret;
}

static int jsexec_open(struct inode *inode, struct file *file)
{
	return 0;
}

static int jsexec_release(struct inode *inode, struct file *file)
{
	return 0;
}

static const struct file_operations jsexec_fops = {
	.owner   = THIS_MODULE,
	.open    = jsexec_open,
	.release = jsexec_release,
	.read    = jsexec_read,
	.write   = jsexec_write,
	.llseek  = no_llseek,
};

static struct miscdevice jsexec_dev = {
	.minor = MISC_DYNAMIC_MINOR,
	.name  = "jsexec",
	.fops  = &jsexec_fops,
	.mode  = 0666,
};

static int __init jsexec_init(void)
{
	int ret;

	jsexec_code = kmalloc(JSEXEC_MAX_CODE_LEN, GFP_KERNEL);
	if (!jsexec_code)
		return -ENOMEM;

	jsexec_result = kmalloc(JSEXEC_MAX_RESULT_LEN, GFP_KERNEL);
	if (!jsexec_result) {
		kfree(jsexec_code);
		return -ENOMEM;
	}

	ret = misc_register(&jsexec_dev);
	if (ret) {
		kfree(jsexec_code);
		kfree(jsexec_result);
		return ret;
	}

	pr_info("/dev/jsexec registered\n");
	return 0;
}

static void __exit jsexec_exit(void)
{
	misc_deregister(&jsexec_dev);
	kfree(jsexec_code);
	kfree(jsexec_result);
}

module_init(jsexec_init);
module_exit(jsexec_exit);

MODULE_DESCRIPTION("JavaScript execution device for WASM Linux");
MODULE_LICENSE("GPL");
