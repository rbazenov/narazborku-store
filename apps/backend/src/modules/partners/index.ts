import { Module } from "@medusajs/framework/utils"
import PartnersModuleService from "./service"

export const PARTNERS_MODULE = "partners"

export default Module(PARTNERS_MODULE, {
  service: PartnersModuleService,
})
