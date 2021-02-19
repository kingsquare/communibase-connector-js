/* global Promise:true */

const Promise = require("bluebird");
const fs = require("fs");
const cbc = require("../../lib/index.js").default.clone(
  process.env.COMMUNIBASE_KEY
);

module.exports = function () {
  console.log("Loading fixtures?");
  const personData = JSON.parse(
    fs.readFileSync(`${__dirname}/../fixtures/person.json`)
  );
  const debtorData = JSON.parse(
    fs.readFileSync(`${__dirname}/../fixtures/debtor.json`)
  );
  const debtor2Data = JSON.parse(
    fs.readFileSync(`${__dirname}/../fixtures/debtor_2.json`)
  );
  const membershipData = JSON.parse(
    fs.readFileSync(`${__dirname}/../fixtures/membership.json`)
  );
  const groupData = JSON.parse(
    fs.readFileSync(`${__dirname}/../fixtures/group.json`)
  );
  const invoiceData = JSON.parse(
    fs.readFileSync(`${__dirname}/../fixtures/invoice.json`)
  );
  const invoice2Data = JSON.parse(
    fs.readFileSync(`${__dirname}/../fixtures/invoice_2.json`)
  );
  const companyData = JSON.parse(
    fs.readFileSync(`${__dirname}/../fixtures/company.json`)
  );
  const eventData = JSON.parse(
    fs.readFileSync(`${__dirname}/../fixtures/event.json`)
  );

  return Promise.all([
    cbc.update("Person", personData),
    cbc.update("Company", companyData),
    cbc.update("Group", groupData),
    cbc.update("Event", eventData),
  ])
    .spread((person, company, group, event) => {
      debtorData.personId = person._id;
      debtorData.companyId = company._id;
      debtor2Data.personId = person._id;
      debtor2Data.addressReference.documentReference.rootDocumentId =
        person._id;
      debtor2Data.companyId = company._id;
      membershipData.groupId = group._id;
      membershipData.personId = person._id;
      membershipData.addressReference = {
        documentReference: {
          rootDocumentEntityType: "Person",
          rootDocumentId: person._id,
          path: [
            {
              field: "addresses",
              objectId: person.addresses[0]._id,
              _id: "5538e68cbb1bf31f00dfee58",
            },
          ],
        },
      };
      process.env.TEST_PERSON_ID = person._id;
      process.env.TEST_COMPANY_ID = company._id;
      process.env.TEST_GROUP_ID = group._id;
      process.env.TEST_EVENT_ID = event._id;
      return Promise.all([
        cbc.update("Debtor", debtorData),
        cbc.update("Debtor", debtor2Data),
      ]);
    })
    .spread((debtor, debtor2) => {
      membershipData.debtorId = debtor._id;

      invoiceData.debtorId = debtor._id;
      invoice2Data.debtorId = debtor._id;

      process.env.TEST_DEBTOR_ID = debtor._id;
      process.env.TEST_DEBTOR_UPDATED_AT = debtor.updatedAt;
      process.env.TEST_DEBTOR_2_ID = debtor2._id;
      return cbc.update("Membership", membershipData);
    })
    .then((membership) => {
      invoiceData.invoiceItems[0].documentReference = {
        _id: null,
        rootDocumentId: membership._id,
        rootDocumentEntityType: "Membership",
        path: [
          {
            field: "invoicedPeriods",
            objectId: membership.invoicedPeriods[3]._id,
          },
        ],
      };
      process.env.TEST_MEMBERSHIP_ID = membership._id;

      return Promise.all([
        cbc.update("Invoice", invoiceData),
        cbc.update("Invoice", invoice2Data),
      ]);
    })
    .spread((invoice, invoice2) => {
      process.env.TEST_INVOICE_ID = invoice._id;
      process.env.TEST_INVOICE_UPDATED_AT = invoice.updatedAt;
      process.env.TEST_INVOICE_2_ID = invoice2._id;
    });
};
