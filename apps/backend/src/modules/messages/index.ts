import { Module } from "@medusajs/framework/utils"
import MessagesModuleService from "./service"

export const MESSAGES_MODULE = "messages"

export default Module(MESSAGES_MODULE, {
  service: MessagesModuleService,
})
