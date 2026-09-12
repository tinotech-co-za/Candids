import {
  queryGeneric,
  mutationGeneric,
  internalQueryGeneric,
  internalMutationGeneric,
  httpActionGeneric,
  type QueryBuilder,
  type MutationBuilder,
  type DataModelFromSchemaDefinition,
  type GenericQueryCtx,
  type GenericMutationCtx,
} from "convex/server";
import schema from "./schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export const query = queryGeneric as QueryBuilder<DataModel, "public">;
export const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
export const internalQuery = internalQueryGeneric as QueryBuilder<
  DataModel,
  "internal"
>;
export const internalMutation = internalMutationGeneric as MutationBuilder<
  DataModel,
  "internal"
>;
export const httpAction = httpActionGeneric;
