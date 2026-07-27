/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _WASM_REMOTE_VM_H
#define _WASM_REMOTE_VM_H

struct task_struct;

void wasm_service_remote_request(struct task_struct *task);

#endif
