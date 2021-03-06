// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/*-----------------------------------------------------------------------------
| Copyright (c) 2014-2018, PhosphorJS Contributors
|
| Distributed under the terms of the BSD 3-Clause License.
|
| The full license is in the file LICENSE, distributed with this software.
|----------------------------------------------------------------------------*/
import {
  IIterator, IterableOrArrayLike, each, map
} from '@lumino/algorithm';

import {
  Datastore, Record, Schema, Table as LTable
} from '@lumino/datastore';

import {
  ITable
} from './interface';


/**
 * A datastore object which holds a collection of records.
 */
export class Table<S extends Schema> implements ITable<S> {
  /**
   * @internal
   *
   * Create a new datastore table.
   *
   * @param schema - The schema for the table.
   *
   * @param context - The datastore context.
   *
   * @returns A new datastore table.
   */
  static create<U extends Schema>(schema: U, context: Datastore.Context): Table<U> {
    return new Table<U>(schema, context);
  }

  /**
   * The schema for the table.
   *
   * #### Complexity
   * `O(1)`
   */
  readonly schema: S;

  /**
   * Whether the table is empty.
   */
  get isEmpty(): boolean {
    return Object.keys(this._records).length === 0
  }

  /**
   * The size of the table.
   */
  get size(): number {
    return Object.keys(this._records).length;
  }

  /**
   * Create an iterator over the records in the table.
   *
   * @returns A new iterator over the table records.
   *
   * #### Complexity
   * `O(log32 n)`
   */
  iter(): IIterator<Record<S>> {
    return map(Object.keys(this._records), key => this._records[key]);
  }

  /**
   * Test whether the table has a particular record.
   *
   * @param id - The id of the record of interest.
   *
   * @returns `true` if the table has the record, `false` otherwise.
   */
  has(id: string): boolean {
    return this._records.hasOwnProperty(id);
  }

  /**
   * Get the record for a particular id in the table.
   *
   * @param id - The id of the record of interest.
   *
   * @returns The record for the specified id, or `undefined` if no
   *   such record exists.
   */
  get(id: string): Record<S> | undefined {
    return this._records[id];
  }

  /**
   * Update one or more records in the table.
   *
   * @param data - The data for updating the records.
   *
   * #### Notes
   * If a specified record does not exist, it will be created.
   *
   * This method may only be called during a datastore transaction.
   */
  update(data: LTable.Update<S>): void {
    // Fetch the context.
    let context = this._context;

    // Ensure the update happens during a transaction.
    if (!context.inTransaction) {
      throw new Error('A table can only be updated during a transaction.');
    }

    // Fetch common variables.
    let schema = this.schema;
    let records = this._records;

    // Iterate over the data.
    for (let id in data) {
      // Get or create the old record.
      let old = this.get(id) || Private.createRecord(schema, id);

      // Apply the update and create the new record.
      let record = Private.applyUpdate(schema, old, data[id], context);

      // Replace the old record in the table.
      records[id] = record;
    }
  }

  /**
   * Construct a new datastore table.
   *
   * @param schema - The schema for the table.
   *
   * @param context - The datastore context.
   */
  private constructor(schema: S, context: Datastore.Context, records?: IterableOrArrayLike<Record<S>>) {
    this.schema = schema;
    this._context = context;
    if (records) {
      each(records, record => {
        this._records[record.$id] = record;
      });
    }
  }

  private _context: Datastore.Context;
  private _records: {[key: string]: Record<S>} = {};
}


/**
 * The namespace for the module implementation details.
 */
namespace Private {
  /**
   * Create a new record object.
   *
   * @param schema - The schema for the record.
   *
   * @param id - The unique id for the record.
   *
   * @returns A new default initialized record.
   */
  export
  function createRecord<S extends Schema>(schema: S, id: string): Record<S> {
    // Create the record objects.
    let record: any = {};

    // Set the base record state.
    record.$id = id;
    // Dummy metadata
    record['@@metadata'] = {};

    // Populate the record.
    for (let name in schema.fields) {
      let field = schema.fields[name];
      record[name] = field.createValue();
    }

    // Return the new record.
    return record;
  }

  /**
   * Apply an update to a record.
   *
   * @param schema - The schema for the record.
   *
   * @param record - The record of interest.
   *
   * @param update - The update to apply to the record.
   *
   * @param context - The datastore context.
   *
   * @returns A new record with the update applied.
   */
  export
  function applyUpdate<S extends Schema>(schema: S, record: Record<S>, update: Record.Update<S>, context: Datastore.Context): Record<S> {
    // Fetch the version and store id.
    let version = context.version;
    let storeId = context.storeId;

    // Fetch or create the table change.
    let tc = context.change[schema.id] || (context.change[schema.id] = {});

    // Fetch or create the record change.
    let rc = tc[record.$id] || (tc[record.$id] = {});

    // Cast the record to a value object.
    let previous = record as Record.Value<S>;

    // Create a clone of the record.
    let clone = { ...(record as any) };

    // Iterate over the update.
    for (let name in update) {
      // Fetch the relevant field.
      let field = schema.fields[name];

      // Apply the update for the field.
      let value;
      let change;
      switch (field.type) {
        case 'text':
          // Set up a variable to hold the current value.
          value = previous[name] as string;

          // Set up the change array.
          change = [];

          let upd = update[name] as any[];
          // Coerce the update into an array of splices.
          if (!Array.isArray(upd)) {
            upd = [upd];
          }

          // Iterate over the update.
          for (let splice of upd) {
            // Unpack the splice.
            let { index, remove, text } = splice;

            // Clamp the index to the string bounds.
            if (index < 0) {
              index = Math.max(0, index + value.length);
            } else {
              index = Math.min(index, value.length);
            }

            // Clamp the remove count to the string bounds.
            let count = Math.min(remove, value.length - index);

            // Compute the removed text.
            let removedText = value.slice(index, index + count);

            // Update the change array.
            change.push({ index, removed: removedText, inserted: text });

            // Compute the new value.
            value = value.slice(0, index) + text + value.slice(index + count);
          }
        case 'list':
          // Create a clone of the previous value.
          let listClone = [...previous[name] as any[]];
          let up = update[name] as any[];

          // Set up the change array.
          change = [];

          // Coerce the update into an array of splices.
          if (!Array.isArray(up)) {
            up = [up];
          }

          // Iterate over the update.
          for (let splice of up) {
            // Unpack the splice.
            let { index, remove, values } = splice;

            // Clamp the index to the array bounds.
            if (index < 0) {
              index = Math.max(0, index + listClone.length);
            } else {
              index = Math.min(index, listClone.length);
            }

            // Clamp the remove count to the array bounds.
            let count = Math.min(remove, listClone.length - index);

            // Apply the splice
            let removedValues = spliceArray(listClone, index, count, values);

            // Update the change array.
            change.push({index, removed: removedValues, inserted: values});
          }

          // Return the update result.
          value = listClone;
          break;
        case 'map':
          // Create a clone of the previous value.
          let mapClone = { ...(previous[name] as any) };

          // Set up the previous and current change parts.
          let prev: { [key: string]: any | null } = {};
          let curr: { [key: string]: any | null } = {};

          // Iterate over the update.
          for (let key in update[name]) {
            // Insert the update value into the metadata.
            let v = update[name][key];

            // Update the map clone with the new value.
            if (v === null) {
              delete mapClone[key];
            } else {
              mapClone[key] = v;
            }

            // Update the previous change part.
            prev[key] = key in previous ? previous[key] : null;

            // Update the current change part.
            curr[key] = v;
          }

          // Create the change object.
          change = { previous: prev, current: curr };
          value = mapClone;
          break;
        case 'register':
          value = update[name]!;
          change = {previous, current: value};
          break;
        default:
          throw new Error(`Dummystore cannot handle field type: ${field.type}`);
      }

      // Assign the new value to the clone.
      clone[name] = value;

      // Merge the change if needed.
      if (name in rc) {
        change = field.mergeChange(rc[name]!, change);
      }

      // Update the record change for the field.
      rc[name] = change;
    }

    // Return the new record.
    return clone;
  }

  /**
   * Splice data into an array.
   *
   * #### Notes
   * This is intentionally similar to Array.splice, but chunks the splices into
   * multiple splices so that it does not crash if the number of spliced IDs
   * is greater than the maximum number of arguments for a function.
   *
   * @param arr - the array on which to perform the splice.
   *
   * @param start - the start index for the splice.
   *
   * @param deleteCount - how many indices to remove.
   *
   * @param items - the items to splice into the array.
   *
   * @returns an array of the deleted elements.
   */
  function spliceArray<T>(arr: T[], start: number, deleteCount?: number, items?: ReadonlyArray<T>): ReadonlyArray<T> {
    if (!items) {
      return arr.splice(start, deleteCount);
    }
    let size = 100000;
    if (items.length < size) {
      return arr.splice(start, deleteCount || 0, ...items);
    }
    let deleted = arr.splice(start, deleteCount);
    let n = Math.floor(items.length / size);
    let idx = 0;
    for (let i = 0; i < n; i++, idx += size) {
      arr.splice(idx, 0, ...items.slice(idx, size));
    }
    arr.splice(idx, 0, ...items.slice(idx));
    return deleted;
  }
}
